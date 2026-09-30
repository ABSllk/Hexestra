import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type OptionHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size' | 'onKeyDown' | 'onFocus' | 'onBlur'>;

/** An inline multi-choice list has no system popup; retain its native range-selection semantics. */
export function MultiSelect({ className, ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple'>) {
  return <select {...props} multiple className={cn('ui-control ui-multi-select', className)} />;
}
type Choice = { value: string; label: string; disabled: boolean };

function optionText(children: ReactNode): string {
  return Children.toArray(children).map((child) => isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : String(child)).join('');
}

function choicesFrom(children: ReactNode, groupDisabled = false): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return [];
    if (child.type === Fragment || child.type === 'optgroup') return choicesFrom(child.props.children, groupDisabled || !!child.props.disabled);
    if (child.type !== 'option') return [];
    const label = child.props.label ?? optionText(child.props.children);
    return [{ value: String(child.props.value ?? label), label, disabled: groupDisabled || !!child.props.disabled }];
  });
}

/** Project-styled single selection, retaining native values, forms and change handlers. */
export function Select({ children, value, defaultValue, onChange, className, id, disabled, title, autoFocus, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...nativeProps }: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-options`;
  const choices = useMemo(() => choicesFrom(children), [children]);
  const firstEnabled = choices.findIndex((choice) => !choice.disabled);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? choices[firstEnabled]?.value ?? ''));
  const selectedValue = String(value ?? internalValue);
  const selectedIndex = choices.findIndex((choice) => choice.value === selectedValue);
  const displayedIndex = selectedIndex < 0 ? firstEnabled : selectedIndex;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(displayedIndex);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: '', time: 0 });

  const show = (index = displayedIndex) => {
    if (disabled || firstEnabled < 0) return;
    window.dispatchEvent(new CustomEvent('hexestra:select-open', { detail: triggerId }));
    setActiveIndex(choices[index]?.disabled ? firstEnabled : index);
    setOpen(true);
  };

  const choose = (index: number) => {
    const choice = choices[index];
    const native = nativeRef.current;
    if (!choice || choice.disabled || !native || disabled) return;
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    if (native.value !== choice.value) {
      native.value = choice.value;
      native.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!triggerRef.current?.contains(node) && !listRef.current?.contains(node)) setOpen(false);
    };
    const otherSelect = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== triggerId) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('hexestra:select-open', otherSelect);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('hexestra:select-open', otherSelect);
    };
  }, [open, triggerId]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const panel = trigger.closest('.left-sidebar-content, .right-sidebar-content, [data-panel]');
    const updatePosition = () => {
      const anchor = trigger.getBoundingClientRect();
      const bounds = panel?.getBoundingClientRect();
      const leftEdge = Math.max(6, (bounds?.left ?? 0) + 6);
      const rightEdge = Math.min(window.innerWidth - 6, (bounds?.right ?? window.innerWidth) - 6);
      const topEdge = Math.max(6, (bounds?.top ?? 0) + 6);
      const bottomEdge = Math.min(window.innerHeight - 6, (bounds?.bottom ?? window.innerHeight) - 6);
      if (anchor.bottom < topEdge || anchor.top > bottomEdge || anchor.width === 0) { setOpen(false); return; }
      const desiredHeight = Math.min(280, choices.length * 32 + 12);
      const below = bottomEdge - anchor.bottom - 6;
      const above = anchor.top - topEdge - 6;
      const placeBelow = below >= desiredHeight || below >= above;
      const maxHeight = Math.max(0, Math.min(280, placeBelow ? below : above));
      const width = Math.min(Math.max(anchor.width, 120), rightEdge - leftEdge);
      setPosition({ left: Math.max(leftEdge, Math.min(anchor.left, rightEdge - width)), top: placeBelow ? anchor.bottom + 6 : anchor.top - 6 - Math.min(desiredHeight, maxHeight), width, maxHeight });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(trigger);
    if (panel) observer.observe(panel);
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, choices.length]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex, listId]);

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const enabled = choices.map((choice, index) => choice.disabled ? -1 : index).filter((index) => index >= 0);
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex); else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!enabled.length) return;
      const current = enabled.indexOf(activeIndex);
      const next = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled[enabled.length - 1]
        : !open ? displayedIndex : enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
      if (open) setActiveIndex(next); else show(next);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const query = (now - searchRef.current.time < 600 ? searchRef.current.text : '') + event.key.toLocaleLowerCase();
      searchRef.current = { text: query, time: now };
      const needle = [...query].every((letter) => letter === query[0]) ? query[0] : query;
      const after = enabled.filter((index) => index > activeIndex).concat(enabled.filter((index) => index <= activeIndex));
      const match = after.find((index) => choices[index].label.toLocaleLowerCase().startsWith(needle));
      if (match !== undefined) { if (open) setActiveIndex(match); else show(match); }
    }
  };

  return <>
    <button ref={triggerRef} id={triggerId} type="button" role="combobox" aria-label={ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid} aria-required={nativeProps.required || undefined} aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox" aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} disabled={disabled} title={title} autoFocus={autoFocus}
      className={cn('ui-control ui-select-trigger inline-flex h-8 min-w-0 items-center justify-between gap-2 px-2.5 text-left text-xs text-text-primary disabled:cursor-not-allowed disabled:opacity-45', className)}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={keyDown} onBlur={() => setOpen(false)}>
      <span className="min-w-0 flex-1 truncate">{choices[displayedIndex]?.label ?? ''}</span>
      <Icon name="chevron-down" size={14} className={cn('shrink-0 text-text-muted transition-transform', open && 'rotate-180')} />
    </button>
    <select {...nativeProps} ref={nativeRef} hidden aria-hidden="true" tabIndex={-1} disabled={disabled} value={value} defaultValue={defaultValue} onChange={(event: ChangeEvent<HTMLSelectElement>) => { onChange?.(event); setInternalValue(event.currentTarget.value); }} onInvalid={(event) => { event.preventDefault(); triggerRef.current?.focus(); nativeProps.onInvalid?.(event); }}>{children}</select>
    {open && createPortal(<div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} aria-labelledby={labelledBy ?? triggerId} data-select-owner={triggerId} className="ui-popover ui-select-menu fixed z-[200] overflow-y-auto overscroll-contain p-1.5" style={position} onPointerDown={(event) => event.preventDefault()}>
      {choices.map((choice, index) => <div key={`${choice.value}-${index}`} id={`${listId}-${index}`} role="option" aria-selected={index === displayedIndex} aria-disabled={choice.disabled || undefined}
        className={cn('ui-select-option flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-text-secondary', index === activeIndex && !choice.disabled && 'bg-raised text-text-primary', choice.disabled && 'cursor-not-allowed opacity-40')}
        onPointerMove={() => { if (!choice.disabled) setActiveIndex(index); }} onClick={() => choose(index)}>
        <span className="min-w-0 flex-1 truncate" title={choice.label}>{choice.label}</span>
        {index === displayedIndex && <Icon name="check" size={14} className="shrink-0 text-text-primary" />}
      </div>)}
    </div>, document.body)}
  </>;
}
