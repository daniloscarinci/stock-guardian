/**
 * The microphone's button, and nothing else.
 *
 * IT IS IN THE SHEET RATHER THAN IN THE HEADER, AND THAT WAS THE FIRST CHANGE.
 * The header button used to be the microphone: pressing it opened the sheet and
 * started a listen in the same gesture. On the phone this feature was built for
 * - no offline Portuguese pack, and the recognizer refusing every offline
 * request - that meant a warning panel on top of the box every single time
 * somebody opened the sheet to type. The failure that killed this feature was a
 * control that appeared dead; burying the control that works under an
 * explanation of the one that does not is the same mistake wearing a hat.
 *
 * So the header opens the sheet, and this asks to listen. Nothing explains
 * itself until somebody has actually asked to speak, and then it explains
 * itself completely.
 *
 * IT IS IN THE COMPOSER ROW, AND THE PANEL IS NOT, WHICH IS THE SECOND CHANGE.
 * This component used to render `MicNotice` above itself, so the button and its
 * bad news were one unit. They cannot be: the button belongs beside the box, in
 * the footer Dialog pins to the bottom edge, because both are ways into the same
 * feature and neither is a fallback for the other - that is the argument this
 * comment has always made, and the composer row is where it lands. The
 * `no-offline-model` panel is a paragraph, two buttons, a collapsible
 * explanation, a settings switch and a conditional hint: up to two hundred
 * pixels of furniture, and a message rather than a control. Messages belong in
 * the scroll box. So the failure leaves as a code, `VoiceSheet` holds it, and
 * `MicNotice` renders it at the top of the body.
 *
 * WHAT LEFT HERE, AND WHY THE THIRD CHANGE WAS THE BIGGEST. This component used
 * to own the recognizer, the `active` ref, the availability probe and the listen
 * itself. All four moved into `useListen`, because a conversation opens the
 * microphone from two places - this button, for the press that starts it, and
 * the loop in `useVoice`, for every utterance after that - and Android's plugin
 * holds one recognizer at a time. Two owners would be a second `startListening`
 * answered with `CODE_BUSY`. One hook, one guard, one release.
 *
 * "Listening…" and the stop control left too, and for a different reason: they
 * have to stand OUTSIDE `inert={voice.busy}`, and this button does not. A
 * conversation runs in exactly the window the sheet declares non-interactive -
 * it is between turns, reading an answer out - so a stop control inside that
 * region would be removed from the accessibility tree at the one moment it is
 * the only thing worth pressing. `VoiceSheet` places both, next to the line that
 * says Claude is being waited on, which is outside for the same reason.
 *
 * What is left is a button, and this file is now the argument for where it sits.
 */
import { useApp } from '../../app/AppContext';
import { Button } from '../../components/ui/primitives';
import { MicIcon } from '../../components/ui/icons';
import styles from './Voice.module.css';

export function MicButton({
  disabled,
  onPress,
}: {
  /**
   * True while this press would go nowhere: a listen is already open, or a
   * conversation is between turns.
   *
   * A `disabled` of its own, on a control that is otherwise covered by the
   * region's `inert`. It is not redundant with it: `useVoice` lifts `busy`
   * before it reads an answer out, so the sheet is deliberately interactive
   * again while the phone is still talking, and that is precisely the window a
   * conversation spends most of its time in.
   */
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { t } = useApp();

  /*
   * `flex: none` on the slot keeps the microphone at its tap target while
   * everything else in the composer row gives ground. See `.micSlot`.
   */
  return (
    <div className={styles.micSlot}>
      <Button iconOnly aria-label={t('voice.micButton')} disabled={disabled} onClick={onPress}>
        <MicIcon />
      </Button>
    </div>
  );
}
