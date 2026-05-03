/**
 * Prontiq Billing Transition Engine
 *
 * Pure business logic. No platform calls. No side effects.
 *
 * This module answers one question: given the customer's current billing state
 * and their requested action, which transition-table row applies, and what must
 * the platform do? The answer is a ledger: timing, money, credits, key policy,
 * destination plan, and the ordered Lago work to perform elsewhere.
 *
 * The engine never mutates a subscription. It only returns the contract.
 *
 * Invariants:
 *   1. Upgrades happen immediately.
 *   2. Prepaid downgrades happen at period end; the customer keeps what they bought.
 *   3. PAYG exits happen immediately; accrued PAYG usage is invoiced at the edge.
 *   4. Refunds are never issued by this flow.
 *   5. API keys are never revoked by this flow.
 *   6. Immediate upgrades preserve unused credits and add the new allowance.
 *   7. Existing scheduled changes are deleted before replacement Lago work is created.
 *
 * Transition table:
 *
 *   #  | From    | To             | Timing     | Money                                                                       | Credits                                                                  | Lago
 *   ---|---------|----------------|------------|-----------------------------------------------------------------------------|--------------------------------------------------------------------------|------------------------------------------
 *   1  | Free    | Capped         | Now        | Full first month charged. New period starts.                                | Carry remaining Free credits + new plan credits granted.                 | Terminate old + create new
 *   2  | Capped  | Larger Capped  | Now        | Full new plan price charged. New period starts. No refund/credit note.      | Carry remaining + new plan credits granted.                              | Terminate old, skip credit note + create new
 *   3  | Capped  | Smaller Capped | Period end | No refund/credit.                                                           | Old cap remains until period end; new plan credits granted at rollover.   | Pending subscription
 *   4  | Capped  | Free           | Period end | No refund/credit.                                                           | Old cap remains until period end; Free credits granted at rollover.       | Pending subscription
 *   5  | Free    | PAYG           | Now        | No immediate charge; metered billing begins after credits are exhausted.     | Carry remaining Free credits.                                             | Terminate old + create new
 *   6  | Capped  | PAYG           | Now        | No refund for unused Capped time; metered billing begins after credits.      | Carry remaining Capped credits.                                           | Terminate old, skip credit note + create new
 *   7  | PAYG    | Capped         | Now        | Invoice accrued PAYG usage immediately; charge full new plan price.          | Fresh start; new plan credits granted.                                    | Terminate old + create new
 *   8  | PAYG    | Free           | Now        | Invoice accrued PAYG usage immediately.                                     | Fresh start; Free credits granted.                                        | Terminate old + create new
 *   9  | Capped  | Cancel         | Period end | No refund/credit.                                                           | Capped credits remain until period end; Free credits at rollover.         | Pending subscription
 *   10 | PAYG    | Cancel         | Now        | Invoice accrued PAYG usage immediately.                                     | Free credits granted immediately.                                         | Terminate old + create new
 *   11 | Any     | Cancel sched.  | Now        | No money movement.                                                          | No credit movement; current plan continues.                               | Delete pending subscription
 */

// -----------------------------------------------------------------------------
// Domain types
// -----------------------------------------------------------------------------

/** Stored in the smallest currency unit. Must be a non-negative safe integer. */
export type Cents = number;

/** Count of product credits. Must be a non-negative safe integer. */
export type Credits = number;

export type PlanArchetype = 'FREE' | 'CAPPED' | 'PAYG';

export interface FreePlan {
  readonly code: string;
  readonly archetype: 'FREE';
  readonly priceCents: 0;
  readonly creditAllowance: Credits;
}

export interface CappedPlan {
  readonly code: string;
  readonly archetype: 'CAPPED';
  readonly priceCents: Cents;
  readonly creditAllowance: Credits;
}

export interface PaygPlan {
  readonly code: string;
  readonly archetype: 'PAYG';
  readonly priceCents: 0;
  readonly creditAllowance: 0;
}

export type Plan = FreePlan | CappedPlan | PaygPlan;

export interface CurrentState {
  readonly plan: Plan;
  readonly creditsRemaining: Credits;
  readonly periodEnd: Date;
  readonly hasPaymentMethod: boolean;
  readonly hasScheduledChange: boolean;

  /** Metered PAYG usage not yet invoiced. Must be 0 unless the current plan is PAYG. */
  readonly accruedPaygUsageCents: Cents;
}

export type BillingIntent =
  | { readonly action: 'change_plan'; readonly targetPlan: Plan }
  | { readonly action: 'cancel'; readonly freePlan: FreePlan }
  | { readonly action: 'cancel_scheduled_change' };

export type TransitionDirection =
  | 'UPGRADE'
  | 'DOWNGRADE'
  | 'LEAVING_PAYG'
  | 'CANCEL'
  | 'CANCEL_SCHEDULED_CHANGE';

export type Timing = 'NOW' | 'PERIOD_END';

/** Immutable effective-time marker returned in every successful decision. */
export type EffectiveAt =
  | { readonly kind: 'NOW' }
  | {
      readonly kind: 'PERIOD_END';
      readonly epochMs: number;
      readonly iso: string;
    };

/**
 * Atomic Lago work, in the exact order emitted by TransitionResult.lagoActions.
 * Compound billing ideas such as “terminate and create” are deliberately split.
 */
export type LagoAction =
  | 'DELETE_PENDING_SUBSCRIPTION'
  | 'TERMINATE_CURRENT_SUBSCRIPTION'
  | 'TERMINATE_CURRENT_SUBSCRIPTION_SKIP_CREDIT_NOTE'
  | 'CREATE_SUBSCRIPTION_NOW'
  | 'CREATE_PENDING_SUBSCRIPTION';

export type LagoActionSequence = readonly [LagoAction, ...LagoAction[]];
export type TableRow = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type TransitionErrorCode =
  | 'PAYMENT_METHOD_REQUIRED'
  | 'LATERAL_MOVE_UNSUPPORTED'
  | 'NON_MONOTONIC_PLAN_CHANGE'
  | 'SAME_PLAN'
  | 'ALREADY_FREE'
  | 'NO_SCHEDULED_CHANGE'
  | 'UNKNOWN_ARCHETYPE'
  | 'INVALID_INTENT'
  | 'INVALID_PLAN'
  | 'INVALID_FREE_PLAN'
  | 'INVALID_CURRENT_STATE';

export interface TransitionError {
  readonly error: TransitionErrorCode;
  readonly message: string;
}

export interface TransitionResult {
  /** The exact row of the product billing table that authorised this decision. */
  readonly tableRow: TableRow;
  readonly direction: TransitionDirection;
  readonly timing: Timing;
  readonly effectiveAt: EffectiveAt;

  /** Source and destination plan codes, copied into the ledger to avoid caller guesswork. */
  readonly fromPlanCode: string;
  readonly toPlanCode: string;

  /** Amount to collect immediately for entering the destination plan. */
  readonly chargeTodayCents: Cents;

  /** Accrued PAYG usage to invoice immediately while leaving or cancelling PAYG. */
  readonly invoiceAccruedPaygCents: Cents;

  /** Always zero in this policy: money never goes backwards. */
  readonly refundCents: 0;

  /** Credits preserved into an immediate destination plan. Zero for period-end changes. */
  readonly creditsCarried: Credits;

  /** Credits granted by the destination plan when it takes effect. */
  readonly creditsGranted: Credits;

  /** True when Lago should start a fresh subscription period immediately. */
  readonly newPeriodStarts: boolean;

  /** Credits usable immediately after accepting this request. */
  readonly creditsAvailableNow: Credits;

  /** Credits usable immediately after the requested transition takes effect. */
  readonly creditsAvailableAfterEffectiveChange: Credits;

  /** Always false in this policy: keys survive billing transitions. */
  readonly keysRevoked: false;

  /** Lago operations to perform, in order. The engine itself performs none of them. */
  readonly lagoActions: LagoActionSequence;

  /** True when the first Lago action deletes a pre-existing pending subscription. */
  readonly deletesExistingScheduledChange: boolean;

  /** True when this decision required and verified the presence of a payment method. */
  readonly requiresPaymentMethod: boolean;
}

export type TransitionOutcome = TransitionResult | TransitionError;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function classifyTransition(
  current: CurrentState,
  intent: BillingIntent,
): TransitionOutcome {
  return classifyTransitionFromUnknown(current, intent);
}

export function classifyTransitionFromUnknown(
  current: unknown,
  intent: unknown,
): TransitionOutcome {
  const currentState = parseCurrentState(current);

  if (isTransitionError(currentState)) {
    return currentState;
  }

  const billingIntent = parseBillingIntent(intent);

  if (isTransitionError(billingIntent)) {
    return billingIntent;
  }

  switch (billingIntent.action) {
    case 'change_plan':
      return changePlan(currentState, billingIntent.targetPlan);

    case 'cancel':
      return cancelPlan(currentState, billingIntent.freePlan);

    case 'cancel_scheduled_change':
      return cancelScheduledChange(currentState);

    default:
      return assertNever(billingIntent, 'Unhandled billing intent.');
  }
}

export function isTransitionError(value: unknown): value is TransitionError {
  return (
    isRecord(value) &&
    typeof value.error === 'string' &&
    typeof value.message === 'string'
  );
}

// -----------------------------------------------------------------------------
// Plan changes: rows 1–8
// -----------------------------------------------------------------------------

type PlanChange =
  | { readonly direction: 'UPGRADE'; readonly tableRow: 1 | 2 | 5 | 6 }
  | { readonly direction: 'DOWNGRADE'; readonly tableRow: 3 | 4 }
  | { readonly direction: 'LEAVING_PAYG'; readonly tableRow: 7 | 8 };

function changePlan(current: CurrentState, target: Plan): TransitionOutcome {
  if (current.plan.code === target.code) {
    return error('SAME_PLAN', 'Already on this plan.');
  }

  const change = classifyPlanChange(current.plan, target);

  if (isTransitionError(change)) {
    return change;
  }

  switch (change.direction) {
    case 'UPGRADE':
      return handleUpgrade(current, target, change.tableRow);

    case 'DOWNGRADE':
      return handleDowngrade(current, target, change.tableRow);

    case 'LEAVING_PAYG':
      return handleLeavingPayg(current, target, change.tableRow);

    default:
      return assertNever(change, 'Unhandled plan-change direction.');
  }
}

function classifyPlanChange(from: Plan, to: Plan): PlanChange | TransitionError {
  if (from.archetype === 'PAYG' && to.archetype === 'CAPPED') {
    return { direction: 'LEAVING_PAYG', tableRow: 7 };
  }

  if (from.archetype === 'PAYG' && to.archetype === 'FREE') {
    return { direction: 'LEAVING_PAYG', tableRow: 8 };
  }

  if (from.archetype === 'FREE' && to.archetype === 'CAPPED') {
    return { direction: 'UPGRADE', tableRow: 1 };
  }

  if (from.archetype === 'CAPPED' && to.archetype === 'CAPPED') {
    return classifyCappedToCapped(from, to);
  }

  if (from.archetype === 'CAPPED' && to.archetype === 'FREE') {
    return { direction: 'DOWNGRADE', tableRow: 4 };
  }

  if (from.archetype === 'FREE' && to.archetype === 'PAYG') {
    return { direction: 'UPGRADE', tableRow: 5 };
  }

  if (from.archetype === 'CAPPED' && to.archetype === 'PAYG') {
    return { direction: 'UPGRADE', tableRow: 6 };
  }

  return error(
    'LATERAL_MOVE_UNSUPPORTED',
    'This billing table does not support same-tier or PAYG-to-PAYG plan changes.',
  );
}

function classifyCappedToCapped(from: CappedPlan, to: CappedPlan): PlanChange | TransitionError {
  const priceDelta = compareNumbers(to.priceCents, from.priceCents);
  const creditDelta = compareNumbers(to.creditAllowance, from.creditAllowance);

  if (priceDelta === 0 && creditDelta === 0) {
    return error(
      'LATERAL_MOVE_UNSUPPORTED',
      'Capped plans with the same price and credit allowance are a lateral move.',
    );
  }

  if (priceDelta > 0 && creditDelta > 0) {
    return { direction: 'UPGRADE', tableRow: 2 };
  }

  if (priceDelta < 0 && creditDelta < 0) {
    return { direction: 'DOWNGRADE', tableRow: 3 };
  }

  return error(
    'NON_MONOTONIC_PLAN_CHANGE',
    'Capped plan price and credit allowance must move in the same direction.',
  );
}

function handleUpgrade(
  current: CurrentState,
  target: Plan,
  tableRow: 1 | 2 | 5 | 6,
): TransitionOutcome {
  const requiresPaymentMethod = requiresPaymentMethodForEntry(target);

  if (requiresPaymentMethod && !current.hasPaymentMethod) {
    return error(
      'PAYMENT_METHOD_REQUIRED',
      'A verified payment method is required to switch to this plan.',
    );
  }

  const creditsCarried = current.creditsRemaining;
  const creditsGranted = target.creditAllowance;
  const creditsAvailable = creditsCarried + creditsGranted;

  return finishTransition(current, {
    tableRow,
    direction: 'UPGRADE',
    timing: 'NOW',
    effectiveAt: now(),
    toPlanCode: target.code,
    chargeTodayCents: target.priceCents,
    invoiceAccruedPaygCents: 0,
    creditsCarried,
    creditsGranted,
    newPeriodStarts: true,
    creditsAvailableNow: creditsAvailable,
    creditsAvailableAfterEffectiveChange: creditsAvailable,
    primaryLagoActions: createNowActions(current.plan.archetype === 'CAPPED'),
    requiresPaymentMethod,
  });
}

function handleDowngrade(
  current: CurrentState,
  target: Plan,
  tableRow: 3 | 4,
): TransitionResult {
  return finishTransition(current, {
    tableRow,
    direction: 'DOWNGRADE',
    timing: 'PERIOD_END',
    effectiveAt: atPeriodEnd(current.periodEnd),
    toPlanCode: target.code,
    chargeTodayCents: 0,
    invoiceAccruedPaygCents: 0,
    creditsCarried: 0,
    creditsGranted: target.creditAllowance,
    newPeriodStarts: false,
    creditsAvailableNow: current.creditsRemaining,
    creditsAvailableAfterEffectiveChange: target.creditAllowance,
    primaryLagoActions: ['CREATE_PENDING_SUBSCRIPTION'],
    requiresPaymentMethod: false,
  });
}

function handleLeavingPayg(
  current: CurrentState,
  target: Plan,
  tableRow: 7 | 8,
): TransitionOutcome {
  const requiresPaymentMethod = target.archetype === 'CAPPED';

  if (requiresPaymentMethod && !current.hasPaymentMethod) {
    return error(
      'PAYMENT_METHOD_REQUIRED',
      'A verified payment method is required to switch from PAYG to a capped plan.',
    );
  }

  return finishTransition(current, {
    tableRow,
    direction: 'LEAVING_PAYG',
    timing: 'NOW',
    effectiveAt: now(),
    toPlanCode: target.code,
    chargeTodayCents: target.priceCents,
    invoiceAccruedPaygCents: current.accruedPaygUsageCents,
    creditsCarried: 0,
    creditsGranted: target.creditAllowance,
    newPeriodStarts: true,
    creditsAvailableNow: target.creditAllowance,
    creditsAvailableAfterEffectiveChange: target.creditAllowance,
    primaryLagoActions: createNowActions(false),
    requiresPaymentMethod,
  });
}

// -----------------------------------------------------------------------------
// Cancellations: rows 9–11
// -----------------------------------------------------------------------------

function cancelPlan(current: CurrentState, freePlan: FreePlan): TransitionOutcome {
  if (current.plan.archetype === 'FREE') {
    return error('ALREADY_FREE', 'Already on the Free plan.');
  }

  if (current.plan.archetype === 'PAYG') {
    return finishTransition(current, {
      tableRow: 10,
      direction: 'CANCEL',
      timing: 'NOW',
      effectiveAt: now(),
      toPlanCode: freePlan.code,
      chargeTodayCents: 0,
      invoiceAccruedPaygCents: current.accruedPaygUsageCents,
      creditsCarried: 0,
      creditsGranted: freePlan.creditAllowance,
      newPeriodStarts: true,
      creditsAvailableNow: freePlan.creditAllowance,
      creditsAvailableAfterEffectiveChange: freePlan.creditAllowance,
      primaryLagoActions: createNowActions(false),
      requiresPaymentMethod: false,
    });
  }

  return finishTransition(current, {
    tableRow: 9,
    direction: 'CANCEL',
    timing: 'PERIOD_END',
    effectiveAt: atPeriodEnd(current.periodEnd),
    toPlanCode: freePlan.code,
    chargeTodayCents: 0,
    invoiceAccruedPaygCents: 0,
    creditsCarried: 0,
    creditsGranted: freePlan.creditAllowance,
    newPeriodStarts: false,
    creditsAvailableNow: current.creditsRemaining,
    creditsAvailableAfterEffectiveChange: freePlan.creditAllowance,
    primaryLagoActions: ['CREATE_PENDING_SUBSCRIPTION'],
    requiresPaymentMethod: false,
  });
}

function cancelScheduledChange(current: CurrentState): TransitionOutcome {
  if (!current.hasScheduledChange) {
    return error('NO_SCHEDULED_CHANGE', 'No scheduled change exists for this subscription.');
  }

  return finishTransition(current, {
    tableRow: 11,
    direction: 'CANCEL_SCHEDULED_CHANGE',
    timing: 'NOW',
    effectiveAt: now(),
    toPlanCode: current.plan.code,
    chargeTodayCents: 0,
    invoiceAccruedPaygCents: 0,
    creditsCarried: 0,
    creditsGranted: 0,
    newPeriodStarts: false,
    creditsAvailableNow: current.creditsRemaining,
    creditsAvailableAfterEffectiveChange: current.creditsRemaining,
    primaryLagoActions: ['DELETE_PENDING_SUBSCRIPTION'],
    requiresPaymentMethod: false,
  });
}

// -----------------------------------------------------------------------------
// Result assembly
// -----------------------------------------------------------------------------

type TransitionDraft = Omit<
  TransitionResult,
  | 'fromPlanCode'
  | 'refundCents'
  | 'keysRevoked'
  | 'lagoActions'
  | 'deletesExistingScheduledChange'
> & {
  readonly primaryLagoActions: LagoActionSequence;
};

function finishTransition(current: CurrentState, draft: TransitionDraft): TransitionResult {
  const { primaryLagoActions, ...ledger } = draft;
  const lagoActions = withScheduledChangeDeletion(current, primaryLagoActions);

  return {
    ...ledger,
    fromPlanCode: current.plan.code,
    refundCents: 0,
    keysRevoked: false,
    lagoActions,
    deletesExistingScheduledChange:
      current.hasScheduledChange && lagoActions[0] === 'DELETE_PENDING_SUBSCRIPTION',
  };
}

function withScheduledChangeDeletion(
  current: CurrentState,
  primaryLagoActions: LagoActionSequence,
): LagoActionSequence {
  if (
    current.hasScheduledChange &&
    primaryLagoActions[0] !== 'DELETE_PENDING_SUBSCRIPTION'
  ) {
    return ['DELETE_PENDING_SUBSCRIPTION', ...primaryLagoActions];
  }

  return primaryLagoActions;
}

function createNowActions(skipCreditNote: boolean): LagoActionSequence {
  return skipCreditNote
    ? ['TERMINATE_CURRENT_SUBSCRIPTION_SKIP_CREDIT_NOTE', 'CREATE_SUBSCRIPTION_NOW']
    : ['TERMINATE_CURRENT_SUBSCRIPTION', 'CREATE_SUBSCRIPTION_NOW'];
}

// -----------------------------------------------------------------------------
// Runtime parsing and validation
// -----------------------------------------------------------------------------

function parseCurrentState(value: unknown): CurrentState | TransitionError {
  if (!isRecord(value)) {
    return error('INVALID_CURRENT_STATE', 'Current billing state must be an object.');
  }

  const plan = parsePlan(value.plan, 'current.plan');

  if (isTransitionError(plan)) {
    return plan;
  }

  if (!isNonNegativeSafeInteger(value.creditsRemaining)) {
    return error('INVALID_CURRENT_STATE', 'creditsRemaining must be a non-negative safe integer.');
  }

  if (!isValidDate(value.periodEnd)) {
    return error('INVALID_CURRENT_STATE', 'periodEnd must be a valid Date.');
  }

  if (typeof value.hasPaymentMethod !== 'boolean') {
    return error('INVALID_CURRENT_STATE', 'hasPaymentMethod must be a boolean.');
  }

  if (typeof value.hasScheduledChange !== 'boolean') {
    return error('INVALID_CURRENT_STATE', 'hasScheduledChange must be a boolean.');
  }

  if (!isNonNegativeSafeInteger(value.accruedPaygUsageCents)) {
    return error('INVALID_CURRENT_STATE', 'accruedPaygUsageCents must be a non-negative safe integer.');
  }

  if (plan.archetype !== 'PAYG' && value.accruedPaygUsageCents !== 0) {
    return error('INVALID_CURRENT_STATE', 'accruedPaygUsageCents must be 0 for non-PAYG plans.');
  }

  return {
    plan,
    creditsRemaining: value.creditsRemaining,
    periodEnd: new Date(value.periodEnd.getTime()),
    hasPaymentMethod: value.hasPaymentMethod,
    hasScheduledChange: value.hasScheduledChange,
    accruedPaygUsageCents: value.accruedPaygUsageCents,
  };
}

function parseBillingIntent(value: unknown): BillingIntent | TransitionError {
  if (!isRecord(value)) {
    return error('INVALID_INTENT', 'Billing intent must be an object.');
  }

  switch (value.action) {
    case 'change_plan': {
      const targetPlan = parsePlan(value.targetPlan, 'targetPlan');

      if (isTransitionError(targetPlan)) {
        return targetPlan;
      }

      return { action: 'change_plan', targetPlan };
    }

    case 'cancel': {
      const freePlan = parsePlan(value.freePlan, 'freePlan');

      if (isTransitionError(freePlan)) {
        return freePlan;
      }

      if (freePlan.archetype !== 'FREE') {
        return error('INVALID_FREE_PLAN', 'Cancel requires the canonical Free plan as its fallback plan.');
      }

      return { action: 'cancel', freePlan };
    }

    case 'cancel_scheduled_change':
      return { action: 'cancel_scheduled_change' };

    default:
      return error('INVALID_INTENT', `Unknown billing action: ${String(value.action)}.`);
  }
}

function parsePlan(value: unknown, label: string): Plan | TransitionError {
  if (!isRecord(value)) {
    return error('INVALID_PLAN', `${label} must be a plan object.`);
  }

  const { archetype, code, creditAllowance, priceCents } = value;

  if (typeof code !== 'string' || code.length === 0 || code.trim() !== code) {
    return error('INVALID_PLAN', `${label}.code must be a non-empty, trim-clean string.`);
  }

  if (!isKnownArchetype(archetype)) {
    return error('UNKNOWN_ARCHETYPE', `${label}.archetype is not recognised: ${String(archetype)}.`);
  }

  if (!isNonNegativeSafeInteger(priceCents)) {
    return error('INVALID_PLAN', `${label}.priceCents must be a non-negative safe integer.`);
  }

  if (!isNonNegativeSafeInteger(creditAllowance)) {
    return error('INVALID_PLAN', `${label}.creditAllowance must be a non-negative safe integer.`);
  }

  switch (archetype) {
    case 'FREE':
      if (priceCents !== 0) {
        return error('INVALID_PLAN', `${label}: Free plans must have priceCents = 0.`);
      }

      return {
        code,
        archetype,
        priceCents: 0,
        creditAllowance,
      };

    case 'CAPPED':
      if (!isPositiveSafeInteger(priceCents)) {
        return error('INVALID_PLAN', `${label}: Capped plans must have a positive priceCents value.`);
      }

      if (!isPositiveSafeInteger(creditAllowance)) {
        return error('INVALID_PLAN', `${label}: Capped plans must grant a positive creditAllowance.`);
      }

      return {
        code,
        archetype,
        priceCents,
        creditAllowance,
      };

    case 'PAYG':
      if (priceCents !== 0) {
        return error('INVALID_PLAN', `${label}: PAYG plans must have priceCents = 0.`);
      }

      if (creditAllowance !== 0) {
        return error('INVALID_PLAN', `${label}: PAYG plans must have creditAllowance = 0.`);
      }

      return {
        code,
        archetype,
        priceCents: 0,
        creditAllowance: 0,
      };

    default:
      return assertNever(archetype, 'Unhandled plan archetype.');
  }
}

// -----------------------------------------------------------------------------
// Preview messages
// -----------------------------------------------------------------------------

export interface PreviewMessageContext {
  /** Human-facing destination plan name, for example “Pro” or “Pay As You Go”. */
  readonly targetPlanName: string;

  /** Human-facing period-end label. The caller owns timezone and locale policy. */
  readonly periodEndLabel: string;

  readonly locale?: string;
  readonly currency?: string;
}

export function generatePreviewMessage(
  result: TransitionResult,
  context: PreviewMessageContext,
): string {
  switch (result.direction) {
    case 'UPGRADE':
      return previewUpgrade(result, context);

    case 'DOWNGRADE':
      return previewDowngrade(result, context);

    case 'LEAVING_PAYG':
      return previewLeavingPayg(result, context);

    case 'CANCEL':
      return previewCancel(result, context);

    case 'CANCEL_SCHEDULED_CHANGE':
      return 'Your scheduled plan change has been cancelled. Your current plan continues. No money or credits have moved.';

    default:
      return assertNever(result.direction, 'Unhandled transition direction in preview.');
  }
}

function previewUpgrade(result: TransitionResult, context: PreviewMessageContext): string {
  if (result.tableRow === 5 || result.tableRow === 6) {
    const carryNote = result.creditsCarried > 0
      ? ` Your ${formatCredits(result.creditsCarried, context)} unused credits will be used before metered billing begins.`
      : '';

    const noRefundNote = result.tableRow === 6
      ? ' No refund will be issued for unused time on your previous capped plan.'
      : '';

    return `You'll switch to Pay As You Go immediately. There is no monthly charge today; usage billing begins after your available credits are exhausted.${carryNote}${noRefundNote}`;
  }

  const carryPhrase = result.creditsCarried > 0
    ? `, plus your ${formatCredits(result.creditsCarried, context)} unused credits — ${formatCredits(result.creditsAvailableNow, context)} total`
    : '';

  const noRefundNote = result.tableRow === 2
    ? ' No refund or credit note will be issued for unused time on your previous capped plan.'
    : '';

  return `You'll be charged ${formatMoney(result.chargeTodayCents, context)} today. Your new billing period starts now with ${formatCredits(result.creditsGranted, context)} credits${carryPhrase}.${noRefundNote}`;
}

function previewDowngrade(result: TransitionResult, context: PreviewMessageContext): string {
  return `Your current plan continues until ${context.periodEndLabel}. No refund or credit will be issued. After that, you'll move to ${context.targetPlanName} with ${formatCredits(result.creditsGranted, context)} credits.`;
}

function previewLeavingPayg(result: TransitionResult, context: PreviewMessageContext): string {
  const paygNote = result.invoiceAccruedPaygCents > 0
    ? `Your outstanding PAYG usage of ${formatMoney(result.invoiceAccruedPaygCents, context)} will be invoiced. `
    : '';

  const chargeNote = result.chargeTodayCents > 0
    ? `You'll be charged ${formatMoney(result.chargeTodayCents, context)} today for ${context.targetPlanName}. `
    : '';

  return `${paygNote}${chargeNote}You'll start fresh with ${formatCredits(result.creditsGranted, context)} credits.`;
}

function previewCancel(result: TransitionResult, context: PreviewMessageContext): string {
  if (result.timing === 'NOW') {
    const paygNote = result.invoiceAccruedPaygCents > 0
      ? ` Outstanding usage of ${formatMoney(result.invoiceAccruedPaygCents, context)} will be invoiced.`
      : '';

    return `Your PAYG plan will end now.${paygNote} Your account moves to the Free plan with ${formatCredits(result.creditsGranted, context)} credits. Your API keys will keep working.`;
  }

  return `Your current plan continues until ${context.periodEndLabel}. No refund or credit will be issued. After that, your account moves to the Free plan with ${formatCredits(result.creditsGranted, context)} credits. Your API keys will keep working.`;
}

// -----------------------------------------------------------------------------
// Small utilities
// -----------------------------------------------------------------------------

const EFFECTIVE_NOW: EffectiveAt = Object.freeze({ kind: 'NOW' } as const);

function now(): EffectiveAt {
  return EFFECTIVE_NOW;
}

function atPeriodEnd(date: Date): EffectiveAt {
  return Object.freeze({
    kind: 'PERIOD_END',
    epochMs: date.getTime(),
    iso: date.toISOString(),
  } as const);
}

function requiresPaymentMethodForEntry(plan: Plan): boolean {
  return plan.archetype === 'CAPPED' || plan.archetype === 'PAYG';
}

function isKnownArchetype(value: unknown): value is PlanArchetype {
  return value === 'FREE' || value === 'CAPPED' || value === 'PAYG';
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function compareNumbers(left: number, right: number): -1 | 0 | 1 {
  if (left > right) return 1;
  if (left < right) return -1;
  return 0;
}

function error(code: TransitionErrorCode, message: string): TransitionError {
  return { error: code, message };
}

function assertNever(value: never, message: string): never {
  throw new Error(`${message} ${String(value)}`);
}

function formatCredits(value: Credits, context: PreviewMessageContext): string {
  return new Intl.NumberFormat(context.locale ?? 'en-US').format(value);
}

function formatMoney(cents: Cents, context: PreviewMessageContext): string {
  return new Intl.NumberFormat(context.locale ?? 'en-US', {
    style: 'currency',
    currency: context.currency ?? 'USD',
  }).format(cents / 100);
}
