declare module "potrace" {
  interface PotraceOptions {
    threshold?: number;
    color?: string;
    background?: string;
    turdSize?: number;
    optTolerance?: number;
    turnPolicy?: string;
  }

  interface PosterizeOptions extends PotraceOptions {
    steps?: number | number[];
    fillStrategy?: string;
  }

  function trace(
    file: string | Buffer,
    options: PotraceOptions,
    callback: (err: Error | null, svg: string) => void
  ): void;
  function trace(
    file: string | Buffer,
    callback: (err: Error | null, svg: string) => void
  ): void;

  function posterize(
    file: string | Buffer,
    options: PosterizeOptions,
    callback: (err: Error | null, svg: string) => void
  ): void;
  function posterize(
    file: string | Buffer,
    callback: (err: Error | null, svg: string) => void
  ): void;
}
