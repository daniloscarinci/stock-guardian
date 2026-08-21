#!/usr/bin/env node
/**
 * Creates the Android release signing key.
 *
 * Android will only install an update over an existing app when both are signed
 * with the same key. Every byte of this application's data lives on the device,
 * so a lost or changed key does not mean "re-sign and carry on" - it means the
 * user must uninstall, and the database goes with it. The key is therefore the
 * single most valuable file this project produces, and the loudest thing this
 * script does is refuse to overwrite one that already exists.
 *
 * It writes PKCS#12 rather than a JKS, and does it with node-forge rather than
 * keytool, so that nothing here needs a JDK installed. Java has read PKCS#12
 * natively for years; it is keytool's own default format now.
 *
 * Run with `npm run generate:android-key`. The output is gitignored, and the
 * printed values go into GitHub Actions secrets - see docs/ANDROID.md.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEYSTORE = resolve(ROOT, 'stock-guardian-release.p12');
const SECRETS = resolve(ROOT, 'android-signing-secrets.txt');

const ALIAS = 'stock-guardian';

/** Thirty years. An app signing key that expires is an app that cannot be updated. */
const VALID_YEARS = 30;

if (existsSync(KEYSTORE)) {
  console.error(`
A signing key already exists at:

  ${KEYSTORE}

It has NOT been touched. Replacing it would mean no future build could update
an installed copy of Stock Guardian - the only way to install a differently
signed APK is to uninstall first, which deletes the database.

If you genuinely want a new identity for the app, move the old file somewhere
safe first, then run this again.
`);
  process.exit(1);
}

/** 32 bytes of entropy, in the alphabet of things that survive being pasted into a form. */
function password() {
  return forge.util
    .encode64(forge.random.getBytesSync(32))
    .replace(/[+/=]/g, '')
    .slice(0, 40);
}

const storePassword = password();

console.log('Generating a 4096-bit RSA key. This takes a few seconds...');
const keys = forge.pki.rsa.generateKeyPair({ bits: 4096, e: 0x10001 });

const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
// A positive serial number. A leading zero byte keeps it from being read as
// negative, which some parsers dislike.
cert.serialNumber = `00${forge.util.bytesToHex(forge.random.getBytesSync(8))}`;
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + VALID_YEARS);

// A self-signed certificate identifying the app, not a person. Nothing verifies
// these fields; they exist so the key is recognisable in a list.
const subject = [
  { name: 'commonName', value: 'Stock Guardian' },
  { name: 'organizationName', value: 'Stock Guardian' },
];
cert.setSubject(subject);
cert.setIssuer(subject);
cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true }]);
cert.sign(keys.privateKey, forge.md.sha256.create());

/*
 * The friendly name becomes the key's alias when Java reads the keystore, which
 * is what `ANDROID_KEY_ALIAS` has to match.
 *
 * One password for both the store and the key: Java's PKCS#12 support treats
 * them as one, and pretending otherwise only produces a second secret that must
 * always equal the first.
 */
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], storePassword, {
  algorithm: 'aes256',
  friendlyName: ALIAS,
  generateLocalKeyId: true,
});

const der = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
writeFileSync(KEYSTORE, der);

const base64 = der.toString('base64');

const fingerprint = createHash('sha256')
  .update(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary'))
  .digest('hex')
  .toUpperCase()
  .replace(/(..)(?=.)/g, '$1:');

/*
 * The password is written to a file rather than printed. A terminal scrollback
 * is a worse place for a signing password than a gitignored file is, and this
 * one has to be copied into a browser anyway.
 */
writeFileSync(
  SECRETS,
  `Stock Guardian - Android signing secrets
========================================

Add these four as repository secrets at
https://github.com/daniloscarinci/stock-guardian/settings/secrets/actions

Then keep this file, and stock-guardian-release.p12, somewhere you will still
have in five years. Without them no future build can update an installed copy
of Stock Guardian - Android would require an uninstall first, and the database
would go with it.

Certificate SHA-256: ${fingerprint}

----------------------------------------
ANDROID_KEY_ALIAS
----------------------------------------
${ALIAS}

----------------------------------------
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_PASSWORD
   (the same value for both, on purpose:
    Java's PKCS#12 support treats the
    store and key passwords as one)
----------------------------------------
${storePassword}

----------------------------------------
ANDROID_KEYSTORE_BASE64
----------------------------------------
${base64}
`,
  'utf8',
);

console.log(`
Written:
  stock-guardian-release.p12    the key itself
  android-signing-secrets.txt   the four values to paste into GitHub

Both are gitignored, and both need backing up.

Certificate SHA-256: ${fingerprint}

Open android-signing-secrets.txt and follow the instructions at the top of it.
The password is in that file and nowhere else - it is not printed here and not
recoverable if the file is lost.
`);
