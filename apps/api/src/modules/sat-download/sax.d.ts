declare module 'sax' {
  export interface Tag {
    name: string;
    local: string;
    uri: string;
    attributes: Record<
      string,
      { name: string; local: string; uri: string; value: string }
    >;
  }
  export interface SAXParser {
    onopentag: ((tag: Tag) => void) | undefined;
    onclosetag: ((name: string) => void) | undefined;
    ontext: ((text: string) => void) | undefined;
    oncdata: ((text: string) => void) | undefined;
    ondoctype: ((text: string) => void) | undefined;
    onerror: ((error: Error) => void) | undefined;
    onprocessinginstruction:
      | ((value: { name: string; body: string }) => void)
      | undefined;
    write(text: string): SAXParser;
    close(): SAXParser;
    flush(): void;
  }
  export function parser(
    strict: boolean,
    options: { xmlns: boolean; strictEntities: boolean },
  ): SAXParser;
}
