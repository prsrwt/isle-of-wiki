/** A run of text; `link` is the target article title when the run is a wiki link. */
export interface Span {
  text: string;
  link?: string;
}

export interface HeadingBlock {
  kind: 'heading';
  level: number;
  text: string;
}

export interface ParagraphBlock {
  kind: 'paragraph';
  spans: Span[];
  /** List nesting depth; 0 for normal paragraphs. */
  indent: number;
  /** Bullet or number prefix for list items. */
  bullet?: string;
}

export interface ImageBlock {
  kind: 'image';
  caption: string;
  /** Thumbnail URL (https), when the figure has an image. */
  src?: string;
  /** width / height */
  aspect: number;
}

export interface TableBlock {
  kind: 'table';
  rows: number;
  cols: number;
  caption: string;
}

export type Block = HeadingBlock | ParagraphBlock | ImageBlock | TableBlock;

export interface InfoboxRow {
  label?: string;
  spans: Span[];
  header?: boolean;
}

export interface ParsedPage {
  title: string;
  blocks: Block[];
  infobox: InfoboxRow[] | null;
  /** Number of distinct article titles linked from the page. */
  linkCount: number;
}
