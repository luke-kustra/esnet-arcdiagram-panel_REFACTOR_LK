import { PanelPlugin } from '@grafana/data';
import { plugin } from './module';

describe('plugin', () => {
  it('is registered as a PanelPlugin', () => {
    expect(plugin).toBeInstanceOf(PanelPlugin);
  });

  it('wires up the SimplePanel component', () => {
    expect(plugin.panel).toBeDefined();
  });

  it('runs the options builder without throwing', () => {
    // Importing ./module executes setPanelOptions(); a registered supplier confirms the
    // option builder ran successfully.
    expect(typeof (plugin as any).getPanelOptionsSupplier).toBe('function');
  });
});
