/**
 * Reasoning / Thinking Part
 * Collapsible block showing the model's chain-of-thought.
 * Uses framer-motion for smooth expand/collapse animation.
 */
import { memo, useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    marginTop: '0.5rem',
    marginBottom: '0.25rem',
  },
};

export interface ReasoningPartProps {
  content: string;
  isThinking?: boolean;
}

export const ReasoningPart = memo(
  function ReasoningPart({ content, isThinking = false }: ReasoningPartProps) {
    const { t } = useTranslation('chat');
    const [expanded, setExpanded] = useState(isThinking);

    // Auto-collapse when thinking finishes
    useEffect(() => {
      if (!isThinking && expanded) {
        setExpanded(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isThinking]);

    return (
      <div className="w-full rounded-lg glass-block-subtle text-sm">
        <button
          className="flex items-center gap-2 w-full px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="font-medium">
            {isThinking ? (
              <span className="animate-pulse">{t('message.thinking')}</span>
            ) : (
              t('message.thinking')
            )}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="reasoning-content"
              initial="collapsed"
              animate="expanded"
              exit="collapsed"
              variants={variants}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
              className="px-3 pb-3 text-muted-foreground"
            >
              <div className="prose prose-sm dark:prose-invert max-w-none opacity-75 pl-4 border-l border-border/50">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
  (prev, next) => {
    if (prev.content !== next.content) return false;
    if (prev.isThinking !== next.isThinking) return false;
    return true;
  }
);
ReasoningPart.displayName = 'ReasoningPart';
