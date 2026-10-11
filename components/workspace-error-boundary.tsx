'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { humanError } from '@/components/ui/human-error';

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
        <Surface variant="glass" radius="card" role="alert" className="mx-auto my-10 flex max-w-xl flex-col items-start gap-4 p-6">
          <h2 className="m-0 text-[17px] font-medium">Не вдалося завантажити {this.props.name ? `«${this.props.name}»` : 'розділ'}</h2>
          <p className="m-0 text-sm text-ink-2">{humanError(this.state.error, 'Сталася непередбачена помилка під час відображення. Спробуй ще раз або перезавантаж сторінку.')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="action" onClick={this.handleReset}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Спробувати ще раз</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>Перезавантажити сторінку</Button>
          </div>
        </Surface>
      );
    }

    return this.props.children;
  }
}
