type MaybeAsync = void | Promise<void>;

export type ModeTransitionPlan = {
  exitCurrent?: () => MaybeAsync;
  applyUiState: () => void;
  enterNext?: () => MaybeAsync;
  onError?: (error: unknown) => void;
};

// Executes the shared mode-transition sequence used by the app:
// current exit hook -> UI state swap -> next enter hook.
export async function runModeTransition(plan: ModeTransitionPlan): Promise<void> {
  try {
    if (plan.exitCurrent) {
      await plan.exitCurrent();
    }
    plan.applyUiState();
    if (plan.enterNext) {
      await plan.enterNext();
    }
  } catch (error) {
    plan.onError?.(error);
  }
}
