/**
 * The ask button in the header.
 *
 * It opens the sheet and does nothing else. It used to own a recognizer, one
 * utterance and a small state machine for everything that can go wrong with a
 * microphone; the microphone is now inside the sheet, next to the box, because
 * a header control that starts listening puts a speech failure in front of
 * everybody who only came to type. `MicButton` has the rest of that argument.
 *
 * Rendering nothing is `askEnabled`'s whole meaning. The sheet, and both ways
 * into it, open from here and from nowhere else, so switching that setting off
 * removes the feature rather than only its entry point.
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
