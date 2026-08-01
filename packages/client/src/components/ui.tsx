// Thin re-export shim — the real implementation lives in packages/shared/ui/ui.tsx
// so both the client and admin web SPA share one source (prevents drift like the
// old Modal.wide being on one side only). All existing `from '../components/ui'`
// imports keep working unchanged.
export * from '../../../shared/ui/ui';
