/**
 * Engine Bootstrap
 * Orchestrates initialization of the Skill Runtime Engine components.
 *
 * Phase 0: ManifestParser, SkillCompiler, ToolRegistry, EmployeeManager, CreditsEngine
 * Phase 1 (lazy): TaskQueue, MessageBus, Supervisor, Memory, Prohibition
 */
import { logger } from '../utils/logger';
import { ManifestParser } from './manifest-parser';
import { SkillCompiler } from './compiler';
import { EmployeeManager } from './employee-manager';
import { CreditsEngine } from './credits-engine';
import { ToolRegistry } from './tool-registry';
import type { GatewayManager } from '../gateway/manager';

/**
 * EngineContext — shared references to all engine components.
 * Passed to IPC handlers and tray binding so they don't create their own instances.
 *
 * Phase 0 components are always available.
 * Phase 1 components are lazily initialized on first access.
 */
export interface EngineContext {
  // Phase 0 — always available
  parser: ManifestParser;
  compiler: SkillCompiler;
  toolRegistry: ToolRegistry;
  employeeManager: EmployeeManager;
  creditsEngine: CreditsEngine;

  // Phase 1 — lazy initialized, access via getLazy(gateway)
  getLazy: (gateway: GatewayManager) => Promise<LazyEngineContext>;
}

/**
 * Phase 1 components — initialized on first access.
 */
export interface LazyEngineContext {
  taskQueue: import('./task-queue').TaskQueue;
  messageBus: import('./message-bus').MessageBus;
  supervisor: import('./supervisor').SupervisorEngine;
  executionWorker: import('./execution-worker').ExecutionWorker;
  memoryEngine: import('./memory').MemoryEngine;
  prohibitionEngine: import('./prohibition').ProhibitionEngine;
  messageStore: import('./message-store').MessageStore;
  taskExecutor: import('./task-executor').TaskExecutor;
}

/**
 * Bootstrap the Skill Runtime Engine (Phase 0).
 * Call this once during app initialization, after the Gateway is started.
 */
/**
 * Pre-flight check: verify that native modules (better-sqlite3) are compiled
 * against the correct Node.js ABI version (Electron's embedded Node, not the
 * system Node). If they mismatch, `require('better-sqlite3')` will throw
 * with NODE_MODULE_VERSION errors and silently block the entire bootstrap.
 */
function checkNativeModules(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('better-sqlite3');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NODE_MODULE_VERSION')) {
      const hint =
        'Native module ABI mismatch detected. ' +
        'better-sqlite3 was compiled for a different Node.js version than Electron uses. ' +
        'Run "npx electron-rebuild -f -w better-sqlite3" and restart the app.';
      logger.error(hint);
      throw new Error(hint, { cause: err });
    }
    // Re-throw other errors (e.g. file not found)
    throw err;
  }
}

export async function bootstrapEngine(): Promise<EngineContext> {
  logger.info('Bootstrapping Skill Runtime Engine (Phase 0)...');

  // Fail fast if native modules are built for the wrong Node ABI
  checkNativeModules();

  // Phase 0: Core components
  const parser = new ManifestParser();
  const compiler = new SkillCompiler();
  const toolRegistry = new ToolRegistry();

  // Wire the ToolRegistry into the compiler
  compiler.setToolRegistry(toolRegistry);

  const employeeManager = new EmployeeManager();

  // Wire EmployeeManager into the compiler (for {{TEAM_ROSTER}} in Supervisor SKILL.md)
  compiler.setEmployeeManager(employeeManager);
  employeeManager.setCompiler(compiler);
  employeeManager.setToolRegistry(toolRegistry);
  await employeeManager.init();

  const creditsEngine = new CreditsEngine();
  creditsEngine.init();

  logger.info('Skill Runtime Engine Phase 0 bootstrap complete');

  // Phase 1: Lazy initialization
  let _lazy: LazyEngineContext | null = null;

  const getLazy = async (gateway: GatewayManager): Promise<LazyEngineContext> => {
    if (_lazy) return _lazy;

    logger.info('Initializing Phase 1 engine components (lazy)...');

    const { TaskQueue } = await import('./task-queue');
    const { MessageBus } = await import('./message-bus');
    const { SupervisorEngine } = await import('./supervisor');
    const { ExecutionWorker } = await import('./execution-worker');
    const { MemoryEngine } = await import('./memory');
    const { ProhibitionEngine } = await import('./prohibition');
    const { MessageStore } = await import('./message-store');
    const { TaskExecutor } = await import('./task-executor');

    const taskQueue = new TaskQueue();
    taskQueue.init();

    const messageBus = new MessageBus(taskQueue.getDb(), () =>
      employeeManager
        .list('idle')
        .concat(employeeManager.list('working'))
        .map((e) => e.id)
    );
    messageBus.init();

    const supervisor = new SupervisorEngine(taskQueue, messageBus, employeeManager, gateway);

    const executionWorker = new ExecutionWorker();

    const memoryEngine = new MemoryEngine();
    memoryEngine.init();

    // Wire memory into the compiler
    compiler.setMemoryEngine(memoryEngine);

    const prohibitionEngine = new ProhibitionEngine();
    prohibitionEngine.init();

    // Wire prohibition engine into the compiler
    compiler.setProhibitionEngine(prohibitionEngine);

    const messageStore = new MessageStore();
    messageStore.init();

    const taskExecutor = new TaskExecutor(taskQueue, employeeManager, gateway);

    _lazy = {
      taskQueue,
      messageBus,
      supervisor,
      executionWorker,
      memoryEngine,
      prohibitionEngine,
      messageStore,
      taskExecutor,
    };

    logger.info('Phase 1 engine components initialized');
    return _lazy;
  };

  return {
    parser,
    compiler,
    toolRegistry,
    employeeManager,
    creditsEngine,
    getLazy,
  };
}
