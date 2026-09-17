import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

export const ONBOARDING_WALKTHROUGH_VERSION = 1;

export type OnboardingFinishDestination = "Today" | "Sources";

export type OnboardingTourStepId =
  "today" | "log" | "context" | "tarvis" | "control";

export interface OnboardingTourStep {
  id: OnboardingTourStepId;
  eyebrow: string;
  title: string;
  detail: string;
  tip: string;
  nextLabel: string;
}

export const ONBOARDING_TOUR_STEPS: readonly OnboardingTourStep[] = [
  {
    id: "today",
    eyebrow: "A CALMER HOME",
    title: "Know what matters now.",
    detail:
      "Today keeps your current glucose, direction and freshness clear without turning your day into a wall of data.",
    tip: "Tap a card when you want the detail. T1 Arc keeps the everyday view deliberately quiet.",
    nextLabel: "Show me around",
  },
  {
    id: "log",
    eyebrow: "ONE QUICK ACTION",
    title: "Log without losing your place.",
    detail:
      "The + button opens one tidy place for food, insulin and health context, then returns you to what you were doing.",
    tip: "Food keeps its exact time and nutrients, so it can be reviewed beside glucose later.",
    nextLabel: "Next",
  },
  {
    id: "context",
    eyebrow: "HISTORY + HEALTH",
    title: "See what happened when.",
    detail:
      "History aligns glucose, insulin, meals and pump events. Health adds steps, sleep and workouts with their real times.",
    tip: "Use the chart controls to show only the layers you need, or tap a health card for its seven-day detail.",
    nextLabel: "Next",
  },
  {
    id: "tarvis",
    eyebrow: "ASK + INSPECT",
    title: "Answers stay linked to evidence.",
    detail:
      "Tarv1s can point out recorded events around a question, while showing the dates, sources and gaps behind its answer.",
    tip: "It supports personal review only. It never recommends doses or pump-setting changes.",
    nextLabel: "Next",
  },
  {
    id: "control",
    eyebrow: "YOUR DATA, YOUR CHOICE",
    title: "Connect only what helps.",
    detail:
      "Choose the services you already use. T1 Arc keeps local records encrypted and gives you clear pause, backup and delete controls.",
    tip: "Nothing is connected by this tour. You decide what to enable, one source at a time.",
    nextLabel: "Finish",
  },
] as const;

export const LAST_ONBOARDING_TOUR_INDEX = ONBOARDING_TOUR_STEPS.length - 1;

export function clampOnboardingTourIndex(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), LAST_ONBOARDING_TOUR_INDEX));
}

export function nextOnboardingTourIndex(value: number) {
  return clampOnboardingTourIndex(value + 1);
}

export function previousOnboardingTourIndex(value: number) {
  return clampOnboardingTourIndex(value - 1);
}

export function onboardingTourProgressLabel(value: number) {
  const index = clampOnboardingTourIndex(value);
  const locale = getRuntimeRegionalDefaults().locale;
  return `Step ${formatRegionalNumber(index + 1, locale, { maximumFractionDigits: 0 })} of ${formatRegionalNumber(ONBOARDING_TOUR_STEPS.length, locale, { maximumFractionDigits: 0 })}`;
}

export function onboardingTransitionDuration(reduceMotion: boolean) {
  return reduceMotion ? 0 : 220;
}

export function onboardingDestinationDataMode(
  destination: OnboardingFinishDestination,
) {
  return destination === "Today" ? "demo" : "live";
}
