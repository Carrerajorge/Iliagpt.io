import React, { ComponentType } from 'react';
import { BaseErrorBoundary } from './BaseErrorBoundary';
import { LazyLoadErrorBoundary } from './LazyLoadErrorBoundary';
import { EditorErrorBoundary } from './EditorErrorBoundary';
import { ThreeJSErrorBoundary } from './ThreeJSErrorBoundary';

type BoundaryType = 'base' | 'lazy' | 'editor' | 'threejs';

interface Options {
  type?: BoundaryType;
  componentName: string;
  editorType?: 'monaco' | 'codemirror' | 'ppt' | 'spreadsheet' | 'document';
  onError?: (error: Error) => void;
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: ComponentType<P>,
  options: Options
) {
  const { type = 'base', componentName, editorType, onError } = options;

  const ComponentWithBoundary = (props: P) => {
    const children = <WrappedComponent {...props} />;

    switch (type) {
      case 'lazy':
        return (
          <LazyLoadErrorBoundary componentName={componentName} onLoadError={onError}>
            {children}
          </LazyLoadErrorBoundary>
        );
      
      case 'editor':
        return (
          <EditorErrorBoundary 
            editorType={editorType || 'monaco'} 
            onError={onError}
          >
            {children}
          </EditorErrorBoundary>
        );
      
      case 'threejs':
        return (
          <ThreeJSErrorBoundary onError={onError}>
            {children}
          </ThreeJSErrorBoundary>
        );
      
      default:
        return (
          <BaseErrorBoundary componentName={componentName} onError={(d) => onError?.(new Error(d.message))}>
            {children}
          </BaseErrorBoundary>
        );
    }
  };

  ComponentWithBoundary.displayName = `withErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;

  return ComponentWithBoundary;
}
