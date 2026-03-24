/**
 * WelcomeScreen — Time-based greeting with animated entrance
 *
 * Features:
 * - Time-of-day greeting (morning / afternoon / evening)
 * - framer-motion fadeIn + slideUp entrance animation
 * - Employee mode: shows employee avatar + "Start a conversation with [name]"
 * - Generic mode: rotating suggestion prompts with flip animation
 */
import { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, MessageSquare, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface WelcomeScreenProps {
  employeeName?: string;
  employeeAvatar?: string;
  employeeAvatarImage?: string;
}

function getGreetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'goodMorning';
  if (hour < 18) return 'goodAfternoon';
  return 'goodEvening';
}

export function WelcomeScreen({ employeeName, employeeAvatar, employeeAvatarImage }: WelcomeScreenProps) {
  const { t } = useTranslation('chat');
  const isEmployee = !!employeeName;

  const greetingKey = useMemo(() => getGreetingKey(), []);

  // Rotating suggestion index for generic mode
  const suggestions = useMemo(
    () => [
      t('welcome.suggestions.askAnything'),
      t('welcome.suggestions.writeCode'),
      t('welcome.suggestions.brainstorm'),
      t('welcome.suggestions.analyzeData'),
    ],
    [t]
  );

  const [activeSuggestion, setActiveSuggestion] = useState(0);

  useEffect(() => {
    if (isEmployee) return;
    const interval = setInterval(() => {
      setActiveSuggestion((prev) => (prev + 1) % suggestions.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [isEmployee, suggestions.length]);

  // Typewriter state for the greeting text
  const fullGreeting = isEmployee
    ? t('welcome.startConversation', { name: employeeName })
    : t(`welcome.greeting.${greetingKey}`);

  const [displayedText, setDisplayedText] = useState('');
  const [typewriterDone, setTypewriterDone] = useState(false);

  const runTypewriter = useCallback(() => {
    let i = 0;
    setDisplayedText('');
    setTypewriterDone(false);
    const timer = setInterval(() => {
      i++;
      if (i <= fullGreeting.length) {
        setDisplayedText(fullGreeting.slice(0, i));
      } else {
        setTypewriterDone(true);
        clearInterval(timer);
      }
    }, 40);
    return () => clearInterval(timer);
  }, [fullGreeting]);

  useEffect(() => {
    // Delay typewriter start to sync with fade-in animation
    const delay = setTimeout(runTypewriter, 400);
    return () => {
      clearTimeout(delay);
    };
  }, [runTypewriter]);

  return (
    <motion.div
      className="flex flex-col items-center justify-center text-center py-20"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Avatar / Icon */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
      >
        {isEmployee ? (
          employeeAvatarImage ? (
            <div className="w-16 h-16 rounded-2xl bg-card glass-border shadow-island overflow-hidden mb-6">
              <img
                src={`local-asset://${employeeAvatarImage}`}
                alt={employeeName}
                className="h-full w-full object-cover object-center"
                draggable={false}
              />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-card glass-border shadow-island flex items-center justify-center mb-6 text-4xl">
              {employeeAvatar || '🤖'}
            </div>
          )
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-card glass-border shadow-island flex items-center justify-center mb-6">
            <Bot className="h-8 w-8 text-primary" />
          </div>
        )}
      </motion.div>

      {/* Greeting with typewriter */}
      <motion.div
        className="min-h-[2.5rem] mb-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <h2 className="text-2xl font-bold">
          {displayedText}
          {!typewriterDone && (
            <span className="inline-block w-0.5 h-6 bg-primary ml-0.5 align-middle animate-pulse" />
          )}
        </h2>
      </motion.div>

      {/* Subtitle */}
      <motion.p
        className="text-muted-foreground mb-8 max-w-md"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      >
        {isEmployee ? t('welcome.employeeSubtitle') : t('welcome.subtitle')}
      </motion.p>

      {/* Suggestion cards (generic mode only) */}
      {!isEmployee && (
        <motion.div
          className="w-full max-w-lg"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.8 }}
        >
          {/* Rotating suggestion prompt */}
          <div className="mb-6 h-8 flex items-center justify-center overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.p
                key={activeSuggestion}
                className="text-sm text-muted-foreground/70 italic"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
              >
                {suggestions[activeSuggestion]}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-2 gap-4">
            {[
              {
                icon: MessageSquare,
                title: t('welcome.askQuestions'),
                desc: t('welcome.askQuestionsDesc'),
              },
              {
                icon: Sparkles,
                title: t('welcome.creativeTasks'),
                desc: t('welcome.creativeTasksDesc'),
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.9 + i * 0.1 }}
              >
                <Card
                  className={cn(
                    'text-left rounded-2xl glass-border shadow-island',
                    'transition-all duration-200 hover:shadow-island-lg hover:scale-[1.02]'
                  )}
                >
                  <CardContent className="p-4">
                    <item.icon className="h-6 w-6 text-primary mb-2" />
                    <h3 className="font-medium">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
