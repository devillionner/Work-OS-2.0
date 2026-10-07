'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  name?: string;
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class WorkspaceErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[WorkspaceErrorBoundary:${this.props.name || 'default'}]`, error, errorInfo);
  }

  handleReset = () => {
    try {
      // Clear potentially corrupt workspace session cache
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key && (key.startsWith('work-os:platform-view:') || key === 'work-os:last-platform')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
    } catch {}
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="workspace-error-container p-6 max-w-xl mx-auto my-12 bg-card border border-border rounded-xl shadow-sm text-center">
          <div className="size-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="size-6" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Не вдалося завантажити {this.props.name || 'розділ'}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {this.state.error?.message || 'Сталася непередбачена помилка під час відображення.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={this.handleReset} variant="default" size="sm">
              <RotateCcw data-icon="inline-start" className="size-4" />
              Спробувати знову
            </Button>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              size="sm"
            >
              Перезавантажити сторінку
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
