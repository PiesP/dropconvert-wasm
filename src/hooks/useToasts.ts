// Toast notification management hook

import { createSignal } from 'solid-js';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
  autoDismissMs?: number;
}

const MAX_TOASTS = 3;
const DEFAULT_AUTO_DISMISS_MS = 5000;

let toastIdCounter = 0;

/**
 * Hook for managing toast notifications
 * Provides a queue-based toast system with max 3 visible toasts
 */
export function useToasts() {
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const generateId = () => `toast-${Date.now()}-${toastIdCounter++}`;

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = generateId();
    const newToast: Toast = {
      ...toast,
      id,
      autoDismissMs: toast.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS,
    };

    setToasts((prev) => {
      // Limit to MAX_TOASTS, remove oldest if necessary
      const updated = [...prev, newToast];
      return updated.slice(-MAX_TOASTS);
    });

    // Auto-dismiss if configured
    if (newToast.autoDismissMs && newToast.autoDismissMs > 0) {
      setTimeout(() => {
        removeToast(id);
      }, newToast.autoDismissMs);
    }

    return id;
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Convenience methods for common toast types
  const showSuccess = (message: string, action?: ToastAction) => {
    return addToast({
      type: 'success',
      message,
      ...(action ? { action } : {}),
      autoDismissMs: DEFAULT_AUTO_DISMISS_MS,
    });
  };

  const showError = (message: string, action?: ToastAction) => {
    return addToast({
      type: 'error',
      message,
      ...(action ? { action } : {}),
      autoDismissMs: 8000, // Errors stay longer
    });
  };

  const showWarning = (message: string, action?: ToastAction) => {
    return addToast({
      type: 'warning',
      message,
      ...(action ? { action } : {}),
      autoDismissMs: 6000,
    });
  };

  const showInfo = (message: string, action?: ToastAction) => {
    return addToast({
      type: 'info',
      message,
      ...(action ? { action } : {}),
      autoDismissMs: DEFAULT_AUTO_DISMISS_MS,
    });
  };

  const clearAll = () => {
    setToasts([]);
  };

  return {
    toasts,
    addToast,
    removeToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    clearAll,
  };
}
