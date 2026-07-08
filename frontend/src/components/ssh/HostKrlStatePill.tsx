import { AlertTriangle } from 'lucide-react';
import { stateLabel, statePillClasses, stateTooltip, type HostKrlStateInfo } from './host-krl-state';

/** Distribution-state pill with a plain-language tooltip (BLK-09). "Not enforced"
 *  gets a warning triangle; in-flight/enforced states get a status dot. */
export function HostKrlStatePill({ state }: { state: HostKrlStateInfo }) {
  const notEnforced = state.state === 'unknown';
  return (
    <span className={statePillClasses(state.state)} title={stateTooltip(state)}>
      {notEnforced ? (
        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
      ) : (
        <span aria-hidden>●&nbsp;</span>
      )}
      {stateLabel(state.state)}
      {state.unsignedLatest ? ' (signing pending)' : ''}
    </span>
  );
}
