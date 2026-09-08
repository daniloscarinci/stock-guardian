/**
 * The ask button in the header.
 *
 * It used to own a recognizer, one utterance and a small state machine for
 * everything that could go wrong with a microphone. All of that is gone:
 * Android's recognizer refuses EXTRA_PREFER_OFFLINE with no offline Portuguese
 * pack installed, which is the phone this was built for, so voice commands were
 * dropped rather than kept as a button that silently did nothing. What is left
 * is a button that opens the sheet, which is what every path through this
 * feature did anyway.
 *
 * Rendering nothing is `askEnabled`'s whole meaning. The sheet, and the box
 * inside it, open from here and from nowhere else, so switching that setting
 * off removes the feature rather than only its entry point.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Button } from '../../components/ui/primitives';
import { AskIcon } from '../../components/ui/icons';
import { VoiceSheet } from './VoiceSheet';

export function VoiceButton() {
  const { t, settings } = useApp();
  const [open, setOpen] = useState(false);

  if (!settings.askEnabled) return null;

  return (
    <>
      <Button
        variant="ghost"
        iconOnly
        aria-label={t('voice.button')}
        onClick={() => {
          setOpen(true);
        }}
      >
        <AskIcon />
      </Button>

      <VoiceSheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
