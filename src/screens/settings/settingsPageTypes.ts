import type { SourceJump } from "@/navigation/sourceNavigation";

/** What every Settings page receives from the Settings screen. */
export interface SettingsPageProps {
  /** The one disclosure (or alarm editor) open on this page, if any. */
  expanded?: string;
  toggle(key: string): void;
  setExpanded(key: string | undefined): void;
  /** Opens another Settings page, optionally with one panel open. */
  openPage(page: SourceJump, expand?: string): void;
  /** Reloads sources after a page changed personal data. */
  onDataChanged(): Promise<void>;
}
