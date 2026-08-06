import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore, useNetMapStore, useSessionStore } from '@/stores';
import { NetMapView } from './NetMapView';

describe('NetMapView', () => {
  it('omits decorative graph labels and interaction instructions', () => {
    render(<NetMapView />);
    expect(screen.queryByText('Domain graph')).not.toBeInTheDocument();
    expect(screen.queryByText('DOMAIN RELATIONSHIPS // LIVE')).not.toBeInTheDocument();
    expect(screen.queryByText(/DRAG NODE/)).not.toBeInTheDocument();
  });
  beforeEach(() => {
    useAppStore.setState({ isNetMapVisible: true, leftPanelView: 'targets' });
    useNetMapStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      highlightedNodeIds: [],
      layout: 'force',
      isLoading: false,
      error: null,
      view: { x: 0, y: 0, scale: 1 },
      positions: {},
    });
    useSessionStore.setState({ targets: [], assets: [] });
  });

  it('renders a clearly labelled front-end preview when no target data exists', () => {
    render(<NetMapView />);

    expect(screen.getByText('PREVIEW TOPOLOGY')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Interactive domain asset graph' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WEB-NODE, vulnerable' })).toBeInTheDocument();
  });

  it('uses a static emphasis ring instead of an expanding node bubble', () => {
    const { container } = render(<NetMapView />);

    const emphasis = screen.getAllByTestId('netmap-node-emphasis');
    expect(emphasis.length).toBeGreaterThan(0);
    expect(emphasis[0]).toHaveAttribute('opacity', '.3');
    expect(container.querySelector('.netmap-node-pulse')).not.toBeInTheDocument();
  });

  it('selects a preview node without adding an asset preview HUD', () => {
    useAppStore.setState({ leftPanelView: 'traffic' });
    render(<NetMapView />);

    const node = screen.getByRole('button', { name: 'WEB-NODE, vulnerable' });
    fireEvent.click(node);
    expect(node).toHaveAttribute('data-relationship-state', 'focused');
    expect(screen.queryByTestId('netmap-node-hud')).not.toBeInTheDocument();
    expect(useAppStore.getState().leftPanelView).toBe('traffic');
  });

  it('opens a real selected node in a NetMap detail overlay without changing the left panel', () => {
    useAppStore.setState({ leftPanelView: 'traffic' });
    useNetMapStore.setState({
      nodes: [
        { id: 'domain-real', label: 'real.example', type: 'domain', status: 'scanned', portCount: 0, vulnCount: 0 },
        { id: 'host-real', label: 'REAL HOST', type: 'host', status: 'scanned', portCount: 1, vulnCount: 0 },
      ],
      edges: [{ id: 'domain-real-host-real', source: 'domain-real', target: 'host-real', type: 'resolves_to' }],
    });
    render(<NetMapView />);

    const node = screen.getByRole('button', { name: 'REAL HOST, scanned' });
    fireEvent.click(node);
    expect(useNetMapStore.getState().selectedNodeId).toBe('host-real');
    expect(useAppStore.getState().leftPanelView).toBe('traffic');
    expect(screen.getByRole('complementary', { name: 'Asset details for REAL HOST' })).toBeInTheDocument();

    useAppStore.setState({ leftPanelView: 'files' });
    fireEvent.click(node);
    expect(useAppStore.getState().leftPanelView).toBe('files');

    fireEvent.click(screen.getByRole('button', { name: 'Close asset details' }));
    expect(useNetMapStore.getState().selectedNodeId).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Asset details for REAL HOST' })).not.toBeInTheDocument();
  });

  it('does not reveal Assets when a real node click was suppressed after dragging', () => {
    useAppStore.setState({ leftPanelView: 'traffic' });
    useNetMapStore.setState({
      nodes: [
        { id: 'domain-drag', label: 'drag.example', type: 'domain', status: 'scanned', portCount: 0, vulnCount: 0 },
        { id: 'host-drag', label: 'DRAG HOST', type: 'host', status: 'scanned', portCount: 0, vulnCount: 0 },
      ],
      edges: [{ id: 'domain-drag-host-drag', source: 'domain-drag', target: 'host-drag', type: 'resolves_to' }],
    });
    render(<NetMapView />);
    const svg = screen.getByRole('img', { name: 'Interactive domain asset graph' });
    const node = screen.getByRole('button', { name: 'DRAG HOST, scanned' });

    fireEvent.mouseDown(node, { button: 0, clientX: 100, clientY: 80 });
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 100 });
    fireEvent.mouseUp(svg, { clientX: 150, clientY: 100 });
    fireEvent.click(node);

    expect(useAppStore.getState().leftPanelView).toBe('traffic');
    expect(useNetMapStore.getState().selectedNodeId).toBeNull();
  });

  it('drags a node independently and keeps connected links attached', () => {
    const { container } = render(<NetMapView />);
    const svg = screen.getByRole('img', { name: 'Interactive domain asset graph' });
    const node = screen.getByRole('button', { name: 'CORE, in_progress' });
    const link = container.querySelector(
      'g[data-edge-source="preview-gateway"][data-edge-target="preview-core"] path',
    );
    const initialNodeTransform = node.getAttribute('transform');
    const initialLinkPath = link?.getAttribute('d');

    fireEvent.mouseDown(node, { button: 0, clientX: 100, clientY: 80 });
    fireEvent.mouseMove(svg, { clientX: 170, clientY: 105 });

    expect(node.getAttribute('transform')).not.toBe(initialNodeTransform);
    expect(link?.getAttribute('d')).not.toBe(initialLinkPath);

    fireEvent.mouseUp(svg, { clientX: 170, clientY: 105 });
    expect(node.getAttribute('transform')).not.toBe(initialNodeTransform);
  });

  it('restores automatic node positions when fitting the topology', () => {
    render(<NetMapView />);
    const svg = screen.getByRole('img', { name: 'Interactive domain asset graph' });
    const node = screen.getByRole('button', { name: 'CORE, in_progress' });
    const initialTransform = node.getAttribute('transform');

    fireEvent.mouseDown(node, { button: 0, clientX: 100, clientY: 80 });
    fireEvent.mouseMove(svg, { clientX: 170, clientY: 105 });
    fireEvent.mouseUp(svg, { clientX: 170, clientY: 105 });
    expect(node.getAttribute('transform')).not.toBe(initialTransform);

    fireEvent.click(screen.getByRole('button', { name: 'Fit topology' }));
    expect(node.getAttribute('transform')).toBe(initialTransform);
  });

  it('keeps restored manual positions inside the current viewport', () => {
    useNetMapStore.setState({
      nodes: [
        { id: 'domain-offscreen', label: 'offscreen.example.com', type: 'domain', status: 'scanned', portCount: 0, vulnCount: 0 },
        { id: 'host-offscreen', label: 'OFFSCREEN', type: 'host', status: 'scanned', portCount: 0, vulnCount: 0 },
      ],
      edges: [{ id: 'domain-host', source: 'domain-offscreen', target: 'host-offscreen', type: 'resolves_to' }],
      selectedNodeId: 'host-offscreen',
      positions: { 'host-offscreen': { x: 5_000, y: 5_000 } },
    });
    render(<NetMapView />);

    const transform = screen
      .getByRole('button', { name: 'OFFSCREEN, scanned' })
      .getAttribute('transform');
    const coordinates = transform?.match(/^translate\(([-\d.]+) ([-\d.]+)\)$/);

    expect(coordinates).not.toBeNull();
    expect(Number(coordinates?.[1])).toBeGreaterThanOrEqual(38);
    expect(Number(coordinates?.[1])).toBeLessThanOrEqual(442);
    expect(Number(coordinates?.[2])).toBeGreaterThanOrEqual(34);
    expect(Number(coordinates?.[2])).toBeLessThanOrEqual(118);
  });

  it('hides the NetMap through its SVG control', () => {
    render(<NetMapView />);

    fireEvent.click(screen.getByRole('button', { name: 'Hide NetMap' }));
    expect(useAppStore.getState().isNetMapVisible).toBe(false);
  });

  it('reveals compact relationship labels on hover', () => {
    const { container } = render(<NetMapView />);
    const relationship = container.querySelector('[aria-label="connected to relationship"]');
    expect(relationship).not.toBeNull();
    fireEvent.mouseEnter(relationship!);
    expect(screen.getByText('CONNECTED TO')).toHaveAttribute('font-size', '7');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByTestId('netmap-edge-label').getAttribute('transform')).not.toContain('scale');
    expect(
      container
        .querySelector('svg[aria-label="Interactive domain asset graph"] > g[transform]')
        ?.getAttribute('transform'),
    ).toContain('scale(1.16)');
  });

  it('focuses the one-hop relationship neighborhood when a node is hovered', () => {
    const { container } = render(<NetMapView />);
    const gateway = screen.getByRole('button', { name: 'GATEWAY, scanned' });
    const unrelated = screen.getByRole('button', { name: 'UNASSOCIATED HOSTS × 2, untested' });

    fireEvent.mouseEnter(gateway);

    expect(container.querySelectorAll('[data-relationship-state="focused"]').length).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-relationship-state="related"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-relationship-state="dimmed"]').length).toBeGreaterThan(0);
    expect(unrelated).toHaveAttribute('opacity', '0.2');
  });

  it('hides non-focused labels in a dense graph and reveals them on hover', () => {
    useNetMapStore.setState({
      nodes: Array.from({ length: 40 }, (_, index) => ({
        id: `dense-${index}`, label: `DENSE-${index}`, type: 'domain' as const,
        status: 'scanned' as const, portCount: 0, vulnCount: 0,
      })),
      edges: [],
      selectedNodeId: 'dense-0',
    });
    render(<NetMapView />);
    expect(screen.queryByText('DENSE-1')).not.toBeInTheDocument();
    const inactiveNode = screen.getByRole('button', { name: 'DENSE-1, scanned' });
    expect(inactiveNode.querySelector('[filter]')).toBeNull();
    fireEvent.mouseEnter(inactiveNode);
    expect(screen.getByText('DENSE-1')).toBeInTheDocument();
    expect(inactiveNode.querySelector('[filter]')).not.toBeNull();
  });

  it('does not animate the decorative scanline for a large graph', () => {
    useNetMapStore.setState({
      nodes: Array.from({ length: 221 }, (_, index) => ({
        id: `large-${index}`, label: `LARGE-${index}`, type: 'domain' as const,
        status: 'scanned' as const, portCount: 0, vulnCount: 0,
      })),
      edges: [],
    });
    const { container } = render(<NetMapView />);
    expect(container.querySelector('.netmap-scanline')).not.toBeInTheDocument();
  });

  it('does not fabricate a Domain focus when the selected node is not projected', () => {
    useNetMapStore.setState({
      nodes: Array.from({ length: 40 }, (_, index) => ({
        id: `domain-${index}`, label: `DOMAIN-${index}`, type: 'domain' as const,
        status: 'scanned' as const, portCount: 0, vulnCount: 0,
      })),
      edges: [{
        id: 'domain-link', source: 'domain-0', target: 'domain-1', type: 'connected_to',
      }],
      selectedNodeId: 'local-host-not-in-domain-view',
    });

    render(<NetMapView />);
    expect(screen.queryByText('DOMAIN-0')).not.toBeInTheDocument();
    expect(screen.queryByText('DOMAIN-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('netmap-node-hud')).not.toBeInTheDocument();
  });
});
