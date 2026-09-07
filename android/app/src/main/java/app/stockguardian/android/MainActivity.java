package app.stockguardian.android;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The native shell. It exists to do the two things a WebView cannot: save
 * exported files, and register SpeechPlugin so the web layer can reach the
 * system's speech recognizer. The download listener below is the first of those.
 *
 * Stock Guardian exports backups and CSV reports with a blob URL and a
 * synthetic anchor click, which every browser understands. Android's WebView
 * does not - it has no download manager of its own, and Capacitor does not
 * install one, so without the listener below every export button in the
 * application would appear to work and produce nothing. For the backup export
 * in particular that is the worst failure this application could have, because
 * the backup file is the only way data leaves a device that is otherwise
 * deliberately sealed.
 *
 * The file's bytes do not come from the blob. They cannot: the WebView passes
 * only the URL, and the page's own Content-Security-Policy (`connect-src
 * 'self'`) would refuse to fetch a `blob:` URL anyway. They come from
 * `window.stockGuardianLastDownload`, which src/services/download.ts sets
 * immediately before the click. That also carries the filename, which the
 * WebView otherwise drops on the floor.
 *
 * No new permission is needed for any of this. On Android 10 and later the file
 * is inserted through MediaStore, which grants access to the one file it just
 * created; on older releases it goes to the application's own external files
 * directory, which never needed a permission either.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "StockGuardian";

    /** Reads the export the web layer just staged. Returns a JSON string, or the literal `null`. */
    private static final String READ_STAGED_DOWNLOAD =
        "JSON.stringify(window.stockGuardianLastDownload || null)";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate, which is when Capacitor builds the bridge and
        // reads the plugin list. Registered later, the plugin does not exist as
        // far as the web layer is concerned.
        registerPlugin(SpeechPlugin.class);

        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        webView.setDownloadListener(
            (url, userAgent, contentDisposition, mimeType, contentLength) -> saveStagedDownload()
        );
    }

    private void saveStagedDownload() {
        // Called on the UI thread by the WebView, which is where evaluateJavascript
        // has to be called from as well.
        getBridge().getWebView().evaluateJavascript(READ_STAGED_DOWNLOAD, this::onStagedDownloadRead);
    }

    private void onStagedDownloadRead(String result) {
        try {
            /*
             * Doubly encoded: evaluateJavascript returns the expression's value as
             * JSON, and the value is itself a JSON string. So unwrap twice.
             */
            Object outer = new JSONTokener(result).nextValue();
            if (!(outer instanceof String)) {
                throw new IOException("The page returned no download to save.");
            }
            Object inner = new JSONTokener((String) outer).nextValue();
            if (!(inner instanceof JSONObject)) {
                throw new IOException("The page returned no download to save.");
            }

            JSONObject staged = (JSONObject) inner;
            String name = staged.getString("name");
            String mime = staged.getString("mime");
            byte[] bytes = staged.getString("text").getBytes(StandardCharsets.UTF_8);

            String location = write(name, mime, bytes);
            toast("Saved to " + location);
        } catch (Exception e) {
            Log.e(TAG, "Could not save the exported file", e);
            toast("Could not save the file: " + e.getMessage());
        }
    }

    /** Writes the file and returns a human-readable description of where it went. */
    private String write(String name, String mime, byte[] bytes) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContentResolver();

            /*
             * IS_PENDING hides the file from other applications until it is fully
             * written, so nothing can read a half-finished backup. MediaStore also
             * resolves name collisions itself, appending "(1)" and so on, which is
             * what a user exporting the same report twice in a day expects.
             */
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new IOException("Android would not create the file.");
            }

            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) {
                    throw new IOException("Android would not open the file for writing.");
                }
                out.write(bytes);
            }

            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);

            return "Downloads";
        }

        // Android 9 and earlier. The public Downloads folder would need
        // WRITE_EXTERNAL_STORAGE here; the application's own external directory
        // needs nothing, so that is where the file goes.
        File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (directory == null) {
            throw new IOException("This device has no available storage for the file.");
        }
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("The storage folder could not be created.");
        }

        File file = new File(directory, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }

        return file.getAbsolutePath();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
