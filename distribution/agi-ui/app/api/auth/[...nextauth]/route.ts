// SPDX-License-Identifier: Apache-2.0
/**
 * Auth.js v5 catch-all route. v5 exposes the request handlers under
 * `handlers.{GET,POST}` — re-export them directly.
 */
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
