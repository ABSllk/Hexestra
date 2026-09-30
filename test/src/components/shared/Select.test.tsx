import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Select, TabbedCard } from '@/components/shared';

const choices = <><option value="one">One</option><option value="blocked" disabled>Blocked</option><option value="two">Two</option><option value="three">Three</option></>;

describe('shared styled Select', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 100, right: 220, bottom: 132, width: 200, height: 32, x: 20, y: 100, toJSON: () => ({}) });
  });
  afterEach(() => vi.restoreAllMocks());

  it('uses a labelled custom popup and forwards real controlled change events', () => {
    const changed = vi.fn();
    function Field() {
      const [value, setValue] = useState('one');
      return <><label htmlFor="choice">Model</label><Select id="choice" name="model" value={value} onChange={(event) => { changed(event.target.value, event.target instanceof HTMLSelectElement); setValue(event.target.value); }}>{choices}</Select></>;
    }
    const { container } = render(<Field />);
    const trigger = screen.getByRole('combobox', { name: 'Model' });
    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('option', { name: 'Two' }));
    expect(trigger).toHaveTextContent('Two');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalledWith('two', true);
    expect(container.querySelector('select')).toHaveAttribute('hidden');
    expect(container.querySelector('select')).toHaveValue('two');
  });

  it('skips disabled options and supports arrows, Home, End and Escape without changing on cancel', () => {
    const changed = vi.fn();
    render(<Select aria-label="Choice" defaultValue="one" onChange={changed}>{choices}</Select>);
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Two' }).id);
    fireEvent.keyDown(trigger, { key: 'End' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Three' }).id);
    fireEvent.keyDown(trigger, { key: 'Home' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'One' }).id);
    fireEvent.click(screen.getByRole('option', { name: 'Blocked' }));
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('supports keyboard selection and typeahead while preserving normal Tab exit', () => {
    render(<><Select aria-label="Choice" defaultValue="one">{choices}</Select><button>Next</button></>);
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 't' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(trigger).toHaveTextContent('Two');
    fireEvent.keyDown(trigger, { key: ' ' });
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    fireEvent(trigger, event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('dismisses on outside pointer without taking focus and opens only one menu', () => {
    render(<><Select aria-label="First">{choices}</Select><Select aria-label="Second">{choices}</Select><button>Outside</button></>);
    fireEvent.click(screen.getByRole('combobox', { name: 'First' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Second' }));
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'First' })).toHaveAttribute('aria-expanded', 'false');
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it('retains reset-on-change behavior for an uncontrolled action picker', () => {
    const changed = vi.fn();
    render(<Select aria-label="Bind" defaultValue="" onChange={(event) => { changed(event.target.value); event.target.value = ''; }}><option value="">Bind profile</option><option value="ssh">SSH profile</option></Select>);
    const trigger = screen.getByRole('combobox');
    for (let index = 0; index < 2; index++) {
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('option', { name: 'SSH profile' }));
      expect(trigger).toHaveTextContent('Bind profile');
    }
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('handles disabled controls, async options and controlled external updates', () => {
    const { rerender } = render(<Select aria-label="Model" value="one" disabled>{choices}</Select>);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    rerender(<Select aria-label="Model" value="two">{choices}</Select>);
    expect(screen.getByRole('combobox')).toHaveTextContent('Two');
    rerender(<Select aria-label="Model" value="new"><option value="new">New model</option></Select>);
    expect(screen.getByRole('combobox')).toHaveTextContent('New model');
  });

  it('flips and constrains the popup within the owning panel', () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-panel') ? { left: 10, right: 310, top: 10, bottom: 250, width: 300, height: 240, x: 10, y: 10, toJSON: () => ({}) }
        : { left: 20, right: 300, top: 200, bottom: 232, width: 280, height: 32, x: 20, y: 200, toJSON: () => ({}) };
    });
    render(<div data-panel><Select aria-label="Choice">{choices}</Select></div>);
    fireEvent.click(screen.getByRole('combobox'));
    const list = screen.getByRole('listbox');
    expect(parseFloat(list.style.top)).toBeLessThan(200);
    expect(parseFloat(list.style.left) + parseFloat(list.style.width)).toBeLessThanOrEqual(304);
    expect(parseFloat(list.style.maxHeight)).toBeLessThanOrEqual(178);
  });
});

it('attached card tabs connect labels, keyboard navigation and the active page', () => {
  function Card() {
    const [value, setValue] = useState('assets');
    return <TabbedCard items={[{ id: 'assets', label: 'Assets' }, { id: 'changes', label: 'Changes' }]} value={value} onChange={setValue}>{value}</TabbedCard>;
  }
  render(<Card />);
  const assets = screen.getByRole('tab', { name: 'Assets' });
  expect(screen.getByRole('tabpanel', { name: 'Assets' })).toHaveTextContent('assets');
  fireEvent.keyDown(assets, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Changes' })).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: 'Changes' })).toHaveTextContent('changes');
});

it('scrolls overflowing attached tabs horizontally with the mouse wheel', () => {
  render(<TabbedCard scrollable label="Settings" items={[{ id: 'general', label: 'General' }, { id: 'mcp', label: 'MCP' }]} value="general" onChange={() => undefined}>Settings</TabbedCard>);
  const tabList = screen.getByRole('tablist', { name: 'Settings' });
  Object.defineProperties(tabList, {
    scrollWidth: { configurable: true, value: 400 },
    clientWidth: { configurable: true, value: 200 },
  });
  const forward = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 72 });
  fireEvent(tabList, forward);
  expect(tabList.scrollLeft).toBe(72);
  expect(forward.defaultPrevented).toBe(true);

  tabList.scrollLeft = 200;
  const atEnd = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 72 });
  fireEvent(tabList, atEnd);
  expect(tabList.scrollLeft).toBe(200);
  expect(atEnd.defaultPrevented).toBe(false);
});
