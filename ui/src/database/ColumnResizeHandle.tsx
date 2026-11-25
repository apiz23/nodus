import { useRef } from 'react';
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../../../src/database/database-view';

const resizeStep = 16;

function boundedWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

export function ColumnResizeHandle({ name, width, layoutWidth, disabled, onResize, onReset }: {
  name: string;
  width?: number;
  layoutWidth: number;
  disabled: boolean;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const sliderWidth = boundedWidth(layoutWidth);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${name} column`}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuenow={sliderWidth}
      aria-valuetext={`${sliderWidth} pixels`}
      aria-keyshortcuts={width === undefined ? "ArrowLeft ArrowRight Home End" : "ArrowLeft ArrowRight Home End Delete"}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title={width === undefined
        ? 'Drag or use Left and Right arrow keys to resize'
        : 'Drag or use arrow keys to resize. Double-click or press Delete to reset.'}
      className="group/resize absolute inset-y-0 right-0 flex w-4 touch-none cursor-col-resize items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-disabled:cursor-default"
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Delete' && width !== undefined) {
          event.preventDefault();
          onReset();
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = sliderWidth;
        const next = event.key === 'Home' ? MIN_COLUMN_WIDTH
          : event.key === 'End' ? MAX_COLUMN_WIDTH
          : boundedWidth(current + (event.key === 'ArrowRight' ? resizeStep : -resizeStep));
        if (next !== current || (width === undefined && (event.key === 'Home' || event.key === 'End'))) onResize(next);
      }}
      onDoubleClick={() => {
        if (!disabled && width !== undefined) onReset();
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || !event.isPrimary || drag.current !== null) return;
        const handle = event.currentTarget;
        event.preventDefault();
        handle.focus({ preventScroll: true });
        handle.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, width: sliderWidth };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (disabled || start === null || start.id !== event.pointerId || (start.x === event.clientX && width === undefined)) return;
        const next = boundedWidth(start.width + event.clientX - start.x);
        if (next !== sliderWidth) onResize(next);
      }}
      onLostPointerCapture={() => { drag.current = null; }}
    >
      <span aria-hidden="true" className="h-4 w-px bg-border group-hover/resize:bg-foreground group-focus-visible/resize:bg-foreground" />
    </div>
  );
}
