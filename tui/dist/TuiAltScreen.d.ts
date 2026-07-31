import type { Terminal } from "./terminal.ts";
import { type TUI, TuiBase } from "./tui.ts";
export interface TuiAltScreenOptions {
    /** Number of logical lines moved for each mouse-wheel event. */
    wheelScrollLines?: number;
    /** Capture mouse events for viewport scrolling and application-owned text selection. */
    mouse?: boolean;
    /** Open an OSC 8 hyperlink activated with a primary-button click. */
    openUrl?: (url: string) => void;
}
/** Alternate-screen TUI with a scrollable, application-owned viewport. */
export declare class TuiAltScreen extends TuiBase implements TUI {
    private previousScreen;
    private lastDocument;
    private previousScreenWidth;
    private previousScreenHeight;
    private scrollTop;
    private contentLineCount;
    private stickToBottom;
    private altScreenActive;
    private imageProtocol;
    private savedCapabilities?;
    private selectionAnchor?;
    private selectionFocus?;
    private pressedUrl?;
    private selectionDragged;
    private readonly wheelScrollLines;
    private readonly mouseEnabled;
    private readonly openUrl?;
    constructor(terminal: Terminal, showHardwareCursor?: boolean, logDirectory?: string, options?: TuiAltScreenOptions);
    get viewportTop(): number;
    get isFollowingOutput(): boolean;
    protected beforeTerminalStart(): void;
    protected beforeTerminalStop(): void;
    protected afterTerminalStop(): void;
    private deleteKittyImages;
    protected resetRenderState(): void;
    scrollBy(lines: number): void;
    scrollToTop(): void;
    scrollToBottom(): void;
    private handleViewportInput;
    private parseWheelDirection;
    private parseSgrMouseEvent;
    private handleSelectionMouseEvent;
    private getSelectionBounds;
    private getSelectionColumns;
    private copySelectionToClipboard;
    private applySelection;
    private isMouseSequence;
    protected doRender(): void;
}
