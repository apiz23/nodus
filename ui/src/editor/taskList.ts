import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { toggleTaskMarker } from './taskMarkers.js';

class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly checked: boolean,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.from === this.from && other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-task-checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.tabIndex = 0;
    input.setAttribute(
      'aria-label',
      this.checked ? 'Mark task as not done' : 'Mark task as done',
    );
    input.addEventListener('change', () => {
      const change = toggleTaskMarker(view.state, this.from + 1);
      if (change !== null) {
        view.dispatch({ changes: change });
        view.focus();
      }
    });
    wrap.appendChild(input);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function taskDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'TaskMarker') return;
        const text = view.state.doc.sliceString(node.from, node.to);
        if (!/^\[[ xX]\]$/.test(text)) return;
        ranges.push(
          Decoration.replace({
            widget: new TaskCheckboxWidget(node.from, text[1] !== ' '),
          }).range(node.from, node.to),
        );
      },
    });
  }

  return Decoration.set(ranges, true);
}

class TaskListPlugin {
  decorations: DecorationSet = Decoration.none;

  constructor(view: EditorView) {
    this.decorations = taskDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = taskDecorations(update.view);
    }
  }
}

export function taskList(): Extension {
  return [
    ViewPlugin.fromClass(TaskListPlugin, {
      decorations: (value) => value.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
        ),
    }),
    EditorView.baseTheme({
      '.cm-task-checkbox': {
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
        marginRight: '0.45em',
        width: '1.05em',
        height: '1.05em',
      },
      '.cm-task-checkbox input': {
        width: '1em',
        height: '1em',
        accentColor: 'var(--primary)',
        cursor: 'pointer',
      },
    }),
  ];
}
