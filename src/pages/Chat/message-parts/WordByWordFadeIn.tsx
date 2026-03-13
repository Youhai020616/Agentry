/**
 * Word-by-word fade-in animation for streaming markdown content.
 * Inspired by better-chatbot's markdown.tsx FadeIn / WordByWordFadeIn.
 * Uses CSS animations (Tailwind animate-in + fade-in) to avoid heavy framer-motion overhead per word.
 */
import { memo, type PropsWithChildren, type ReactNode } from 'react';

const FadeIn = memo(function FadeIn({ children }: PropsWithChildren) {
  return (
    <span
      className="inline animate-in fade-in duration-700"
      style={{ animationFillMode: 'both' }}
    >
      {children}{' '}
    </span>
  );
});

/**
 * Splits children into words and wraps each in a fade-in span.
 * Non-string children (e.g. JSX elements) are passed through as-is.
 * Should ONLY be used when streaming — static content should render plain.
 */
export const WordByWordFadeIn = memo(function WordByWordFadeIn({ children }: PropsWithChildren) {
  const flat: ReactNode[] = Array.isArray(children) ? children : [children];
  const result: ReactNode[] = [];

  for (let i = 0; i < flat.length; i++) {
    const child = flat[i];
    if (typeof child === 'string') {
      const words = child.split(' ');
      for (let j = 0; j < words.length; j++) {
        if (words[j]) {
          result.push(<FadeIn key={`${i}-${j}`}>{words[j]}</FadeIn>);
        }
      }
    } else {
      result.push(child);
    }
  }

  return <>{result}</>;
});
