import { TarvisAnswer } from "./types";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

export function formatTarvisConversation(
  exchanges: { question: string; answer: TarvisAnswer }[],
) {
  const regional = getRuntimeRegionalDefaults();
  const header = `Ask Tarv1s conversation\nExported ${new Date().toLocaleString(regional.locale, { timeZone: regional.timeZone })}\n\n`;
  return (
    header +
    exchanges
      .map(
        (exchange) =>
          `You\n${exchange.question}\n\nTarv1s — ${exchange.answer.headline}\n${exchange.answer.answer}${
            exchange.answer.limitations.length
              ? `\n\nLimitations\n${exchange.answer.limitations
                  .map((item) => `- ${item}`)
                  .join("\n")}`
              : ""
          }`,
      )
      .join("\n\n---\n\n")
  );
}
