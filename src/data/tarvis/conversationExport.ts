import { TarvisAnswer } from './types';

export function formatTarvisConversation(
  exchanges: Array<{ question: string; answer: TarvisAnswer }>,
) {
  const header = `Ask Tarv1s conversation\nExported ${new Date().toLocaleString('en-GB')}\n\n`;
  return (
    header +
    exchanges
      .map(
        (exchange) =>
          `You\n${exchange.question}\n\nTarv1s — ${exchange.answer.headline}\n${exchange.answer.answer}${
            exchange.answer.limitations.length
              ? `\n\nLimitations\n${exchange.answer.limitations
                  .map((item) => `- ${item}`)
                  .join('\n')}`
              : ''
          }`,
      )
      .join('\n\n---\n\n')
  );
}
