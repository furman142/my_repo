import { existsSync } from 'node:fs';
import { config } from '../config.js';
import { redact } from '../security/redact.js';
import { ObjectDetector } from './yolox.js';

export type ObjectsState = 'off' | 'loading' | 'ready' | 'error';

/**
 * One shared object detector for all cameras, loaded on first use. If the model or the runtime
 * cannot be loaded, the state is 'error' and everything keeps working as plain motion detection.
 */
class ObjectService {
  state: ObjectsState = 'off';
  error: string | null = null;
  private detector: ObjectDetector | null = null;

  ensure(): void {
    if (this.state === 'loading' || this.state === 'ready') return;
    this.state = 'loading';
    this.error = null;
    if (!existsSync(config.model)) {
      this.state = 'error';
      this.error = 'model file missing (run: npm run install:model)';
      return;
    }
    ObjectDetector.load(config.model)
      .then((d) => {
        this.detector = d;
        this.state = 'ready';
      })
      .catch((err) => {
        this.state = 'error';
        this.error = redact(String((err as Error).message ?? err)).slice(0, 300);
      });
  }

  disable(): void {
    if (this.state !== 'ready') this.state = 'off';
  }

  /** The detector when it is loaded and idle; null otherwise (callers simply skip the frame). */
  get idle(): ObjectDetector | null {
    return this.state === 'ready' && this.detector && !this.detector.isBusy ? this.detector : null;
  }

  get ready(): boolean {
    return this.state === 'ready';
  }
}

export const objects = new ObjectService();
