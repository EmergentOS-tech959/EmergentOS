/**
 * EmergentOS - Error Classification
 * 
 * Error handling utilities from Section 14.
 */

export interface ClassifiedError {
  retryable: boolean;
  category: 'auth' | 'rate_limit' | 'network' | 'server' | 'client' | 'unknown';
  action: 'retry' | 'reconnect' | 'fail' | 'backoff';
}

/**
 * Classify an error to determine the appropriate action
 */
export function classifyError(error: unknown): ClassifiedError {
  const errorObj = error as { 
    status?: number; 
    code?: string | number;
    message?: string;
  };
  
  const status = errorObj.status || (typeof errorObj.code === 'number' ? errorObj.code : undefined);
  const code = typeof errorObj.code === 'string' ? errorObj.code : undefined;
  
  // Auth errors - need user to reconnect
  if (status === 401 || status === 403) {
    return {
      retryable: false,
      category: 'auth',
      action: 'reconnect',
    };
  }
  
  // Rate limits - retry with backoff
  if (status === 429) {
    return {
      retryable: true,
      category: 'rate_limit',
      action: 'backoff',
    };
  }
  
  // Network errors - retry
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return {
      retryable: true,
      category: 'network',
      action: 'retry',
    };
  }
  
  // Server errors - retry
  if (status && status >= 500 && status < 600) {
    return {
      retryable: true,
      category: 'server',
      action: 'retry',
    };
  }
  
  // Client errors (except auth) - don't retry
  if (status && status >= 400 && status < 500) {
    return {
      retryable: false,
      category: 'client',
      action: 'fail',
    };
  }
  
  // Unknown - attempt retry
  return {
    retryable: true,
    category: 'unknown',
    action: 'retry',
  };
}

/**
 * Format an error for logging/storage
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

/**
 * Check if an error is a network/connectivity error
 */
export function isNetworkError(error: unknown): boolean {
  const classified = classifyError(error);
  return classified.category === 'network';
}

/**
 * Check if an error requires user reconnection
 */
export function requiresReconnect(error: unknown): boolean {
  const classified = classifyError(error);
  return classified.action === 'reconnect';
}
