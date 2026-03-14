/**
 * Studio Pipeline IPC Handlers
 * Media content creation pipeline (brand analysis, text, image, video, publish).
 */
import { ipcMain } from 'electron';
import { StudioService } from '../../engine/studio-service';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager, mainWindow }: IpcContext): void {
  let _studioService: StudioService | null = null;
  const getService = () => {
    if (!_studioService) {
      _studioService = new StudioService(engineRef, gatewayManager, mainWindow);
    }
    return _studioService;
  };

  ipcMain.handle(
    'studio:brand-analysis',
    async (
      _,
      params: { brandName: string; industry: string; platforms: string[]; competitors?: string }
    ) => {
      try {
        const result = await getService().brandAnalysis(params);
        return { success: true, result };
      } catch (error) {
        logger.error('studio:brand-analysis failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'studio:text-generation',
    async (
      _,
      params: {
        brandAnalysis: unknown;
        platform: string;
        contentType?: string;
      }
    ) => {
      try {
        const result = await getService().textGeneration(
          params as Parameters<StudioService['textGeneration']>[0]
        );
        return { success: true, result };
      } catch (error) {
        logger.error('studio:text-generation failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'studio:image-generation',
    async (
      _,
      params: { text: unknown; count?: number; imageApiKey?: string; imageModel?: string }
    ) => {
      try {
        const result = await getService().imageGeneration(
          params as Parameters<StudioService['imageGeneration']>[0]
        );
        return { success: true, result };
      } catch (error) {
        logger.error('studio:image-generation failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'studio:video-generation',
    async (
      _,
      params: {
        text: unknown;
        images: unknown;
        style?: string;
        videoModel?: string;
        videoApiUrl?: string;
        videoApiKey?: string;
      }
    ) => {
      try {
        const result = await getService().videoGeneration(
          params as Parameters<StudioService['videoGeneration']>[0]
        );
        return { success: true, result };
      } catch (error) {
        logger.error('studio:video-generation failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'studio:publish',
    async (
      _,
      params: {
        platform: string;
        text: unknown;
        images: unknown;
        video?: unknown;
      }
    ) => {
      try {
        const result = await getService().publish(
          params as Parameters<StudioService['publish']>[0]
        );
        return { success: true, result };
      } catch (error) {
        logger.error('studio:publish failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('studio:cancel', async () => {
    try {
      getService().cancel();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
