import ejs from 'ejs';
import mjml2html from 'mjml';

export class EmailTemplateRenderer {
  static async render(
    template: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const resolvedTemplate = ejs.render(template, data);
    const result = await mjml2html(resolvedTemplate);

    if (result.errors.length > 0) {
      throw new Error(
        `Invalid MJML email template: ${result.errors
          .map((error) => error.message)
          .join('; ')}`,
      );
    }

    return result.html;
  }
}
