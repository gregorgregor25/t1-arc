import type { TarvisAnswer, TarvisReviewedKnowledgeItem } from "./types";
import {
  NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
  NICE_TYPE_1_EXERCISE_KNOWLEDGE,
  NICE_TYPE_1_SICK_DAY_KNOWLEDGE,
} from "./reviewedKnowledge";
import { isTarvisDependentFollowUp, isTarvisSourceFollowUp } from "./scope";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

function childSickDayFallback(): TarvisAnswer {
  return {
    headline: "What NICE says about sick days for children and young people",
    answer:
      "NICE NG18 says a child or young person with Type 1 diabetes and their family or carers should have individualised oral and written sick-day rules for illness or hyperglycaemia. That individualised plan should cover monitoring glucose, monitoring and interpreting blood ketones, adjusting the insulin regimen, food and fluid intake, and when and where to get further advice or help. NICE says the advice should be revisited at least annually.\n\nNICE also says children and young people should be offered blood ketone testing strips and a meter and advised to test for ketonaemia if they are ill or have hyperglycaemia. If they use capillary blood glucose monitoring, more frequent testing is often needed during illness. These are the topics their individualised sick-day plan should cover, not a universal insulin-adjustment formula; follow the plan agreed with their diabetes team for exact actions.\n\nT1 Arc safety note — separate from the NICE recommendations cited below: questions describing current severe symptoms, suspected DKA or immediate danger take the urgent-safety route, which does not wait for record analysis.",
    confidence: "high",
    evidenceIds: [],
    limitations: [
      "The NICE summary above covers NG18 recommendations 1.2.72, 1.2.82 and 1.2.83; the separately labelled T1 Arc safety note describes app behaviour. Neither replaces the child or young person’s individualised sick-day plan.",
      "NICE describes its guidelines as recommendations for England and Wales; Scotland and Northern Ireland decide separately how they apply.",
    ],
  };
}

function sickDayFallback(): TarvisAnswer {
  return {
    headline: "What NICE says about sick days",
    answer:
      "NICE says you should have clear sick-day rules agreed with your diabetes team, including how insulin is adjusted when you’re ill. It also says blood or urine ketone monitoring should be considered and, for adults who use capillary blood glucose monitoring, measurements should be taken more often during illness.\n\nNG17 doesn’t give one insulin-adjustment formula for every adult, so Tarv1s won’t make one up. Your own sick-day plan remains the authority for exact actions.\n\nT1 Arc safety note — separate from the NICE recommendations cited below: questions describing current severe symptoms, suspected DKA or immediate danger take the urgent-safety route, which does not wait for record analysis.",
    confidence: "high",
    evidenceIds: [],
    limitations: [
      "The NICE summary above covers NG17 recommendations 1.6.20, 1.7.23 and 1.10.1; the separately labelled T1 Arc safety note describes app behaviour. Neither replaces your individual sick-day plan.",
      "NICE describes its guidelines as recommendations for England and Wales; Scotland and Northern Ireland decide separately how they apply.",
    ],
  };
}

function exerciseFallback(): TarvisAnswer {
  return {
    headline: "What NICE says about activity",
    answer:
      "NICE says physical activity is likely to lower glucose when insulin levels are adequate. It also says that, when someone is both hyperglycaemic and hypoinsulinaemic, physical activity can worsen hyperglycaemia and ketonaemia may occur. The response differs from person to person, and its guidance says glucose monitoring and changing insulin or nutritional needs may matter during activity, immediately afterwards and for the following 24 hours.\n\nA recorded insulin or notification-reported IOB value can help describe the timing, but it doesn’t prove physiological insulin levels were adequate. These records can support a cautious explanation; they still can’t prove the cause of one event or justify an insulin-dose recommendation.",
    confidence: "high",
    evidenceIds: [],
    limitations: [
      "This summarises NICE NG17 recommendations 1.5.1 and 1.5.2 and is general guidance, not an individual treatment plan.",
      "NICE describes its guidelines as recommendations for England and Wales; Scotland and Northern Ireland decide separately how they apply.",
    ],
  };
}

function detailedSickDayCopy() {
  return "Here’s the useful detail NICE separates out. Recommendation 1.7.23 says adults with Type 1 diabetes should be given clear sick-day guidelines and protocols to help them adjust insulin appropriately when they’re ill. Recommendation 1.10.1 says blood or urine ketone monitoring should be considered as part of those rules. Recommendation 1.6.20 applies specifically to adults using capillary blood glucose monitoring and supports measuring more often during illness.\n\nNG17 still doesn’t supply one universal dosing formula. Your own agreed sick-day plan is the right place for exact actions, and Tarv1s won’t invent the missing instructions.";
}

function detailedChildSickDayCopy() {
  return "Here’s the useful detail NICE NG18 separates out for children and young people. Recommendation 1.2.82 says their oral and written sick-day rules should be individualised, cover illness or hyperglycaemia, and address glucose monitoring, blood-ketone monitoring and interpretation, insulin-regimen adjustments, food and fluid intake, and when and where to seek further advice or help. It says to revisit that advice at least annually. Recommendation 1.2.83 says to offer blood ketone testing strips and a meter and advise testing for ketonaemia during illness or hyperglycaemia. Recommendation 1.2.72 says children and young people using capillary blood glucose monitoring often need more frequent testing during illness.\n\nThese recommendations do not provide a substitute insulin-adjustment formula. Follow the child or young person’s individualised sick-day plan for exact actions.\n\nT1 Arc safety note — separate from the NICE recommendations cited below: questions describing current severe symptoms, suspected DKA or immediate danger take the urgent-safety route, which does not wait for record analysis.";
}

function detailedExerciseCopy() {
  return "The key detail in NICE NG17 is that it separates two different conditions. With adequate insulin levels, physical activity is likely to lower glucose. When someone is both hyperglycaemic and hypoinsulinaemic, activity can instead worsen hyperglycaemia and ketonaemia may occur. Recommendation 1.5.2 also covers monitoring and changed insulin or nutritional needs during activity, immediately afterwards and over the following 24 hours.\n\nThat helps frame a cautious review of recorded timing, but a logged dose or IOB value still doesn’t prove physiological insulin adequacy, the cause of one event, or the right treatment change.";
}

function reviewedKnowledgeDetail(
  knowledge: readonly TarvisReviewedKnowledgeItem[],
): TarvisAnswer {
  const childSickDay = knowledge.some(
    ({ id }) => id === NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id,
  );
  const sickDay = knowledge.some(
    ({ id }) => id === NICE_TYPE_1_SICK_DAY_KNOWLEDGE.id,
  );
  const exercise = knowledge.some(
    ({ id }) => id === NICE_TYPE_1_EXERCISE_KNOWLEDGE.id,
  );
  return {
    headline: "A closer look at the NICE guidance",
    answer: [
      ...(childSickDay ? [detailedChildSickDayCopy()] : []),
      ...(!childSickDay && sickDay ? [detailedSickDayCopy()] : []),
      ...(!childSickDay && exercise ? [detailedExerciseCopy()] : []),
    ].join("\n\n"),
    confidence: "high",
    evidenceIds: [],
    limitations: reviewedKnowledgeFallback(knowledge).limitations,
  };
}

function reviewedKnowledgeSource(
  knowledge: readonly TarvisReviewedKnowledgeItem[],
): TarvisAnswer {
  const childSickDay = knowledge.some(
    ({ id }) => id === NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id,
  );
  const sources = knowledge
    .filter(
      ({ id }) =>
        !childSickDay || id === NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id,
    )
    .map(
      ({ recommendationRefs, sourceTitle }) =>
        `${sourceTitle}, recommendations ${recommendationRefs.join(", ")}`,
    );
  return {
    headline: "The NICE guidance behind that",
    answer: `That comes from ${sources.join("; ")}. I’ve kept the source link${sources.length === 1 ? "" : "s"} directly below this answer so you can open the current NICE wording yourself.`,
    confidence: "high",
    evidenceIds: [],
    limitations: [
      childSickDay
        ? "Tarv1s is showing reviewed NICE guidance, not the child or young person’s individualised sick-day plan."
        : "Tarv1s is showing reviewed NICE guidance, not an individual treatment plan.",
    ],
  };
}

export function reviewedKnowledgeFallback(
  knowledge: readonly TarvisReviewedKnowledgeItem[],
): TarvisAnswer {
  const regional = getRuntimeRegionalDefaults();
  if (knowledge.length === 0 && regional.clinicalJurisdiction !== "GB") {
    return {
      headline: "Reviewed guidance is not installed for your region",
      answer:
        "Tarv1s can analyse your recorded health data, but T1 Arc does not yet include source-reviewed clinical guidance for your selected jurisdiction. I won’t substitute UK guidance or improvise local medical rules. You can still ask about NICE explicitly if you want to read the UK source.",
      confidence: "high",
      evidenceIds: [],
      limitations: [
        `Selected clinical jurisdiction: ${regional.clinicalJurisdiction}.`,
        "This does not affect urgent safety routing or analysis of your own records.",
      ],
    };
  }
  const childSickDay = knowledge.some(
    ({ id }) => id === NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id,
  );
  if (childSickDay) return childSickDayFallback();
  const sickDay = knowledge.some(
    ({ id }) => id === NICE_TYPE_1_SICK_DAY_KNOWLEDGE.id,
  );
  const exercise = knowledge.some(
    ({ id }) => id === NICE_TYPE_1_EXERCISE_KNOWLEDGE.id,
  );
  if (sickDay && exercise) {
    const sickDayAnswer = sickDayFallback();
    const exerciseAnswer = exerciseFallback();
    return {
      headline: "What NICE says about sick days and activity",
      answer: `${sickDayAnswer.answer}\n\n${exerciseAnswer.answer}`,
      confidence: "high",
      evidenceIds: [],
      limitations: [
        ...new Set([
          ...sickDayAnswer.limitations,
          ...exerciseAnswer.limitations,
        ]),
      ],
    };
  }
  if (sickDay) return sickDayFallback();
  if (exercise) return exerciseFallback();
  return {
    headline: "NICE guidance",
    answer:
      "I don’t have enough reviewed NICE guidance for that question yet, so I won’t fill the gap from memory.",
    confidence: "limited",
    evidenceIds: [],
    limitations: ["No reviewed guidance item supported a fuller answer."],
  };
}

export function reviewedKnowledgeAnswerForTurn(
  question: string,
  knowledge: readonly TarvisReviewedKnowledgeItem[],
  hasPreviousExchange: boolean,
) {
  if (!hasPreviousExchange || !isTarvisDependentFollowUp(question)) {
    return reviewedKnowledgeFallback(knowledge);
  }
  if (isTarvisSourceFollowUp(question)) {
    return reviewedKnowledgeSource(knowledge);
  }
  return reviewedKnowledgeDetail(knowledge);
}

/**
 * Reviewed NICE guidance is source-locked for this release. A hosted request may
 * choose which supplied source is relevant, but no model-authored medical copy
 * is ever displayed; the app always renders the vetted local wording.
 */
export function parseTarvisReviewedKnowledgeAnswer(
  _value: string,
  knowledge: readonly TarvisReviewedKnowledgeItem[],
): TarvisAnswer {
  return reviewedKnowledgeFallback(knowledge);
}
