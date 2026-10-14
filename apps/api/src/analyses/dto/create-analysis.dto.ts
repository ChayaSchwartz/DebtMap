import { parseRepoUrl } from '@debtmap/shared';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * Validates with the same parser the analyzer uses, so the API can never accept
 * a URL the engine would then reject — the two cannot drift apart.
 */
function IsPublicGitHubRepoUrl(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isPublicGitHubRepoUrl',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && parseRepoUrl(value) !== null;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a public GitHub repository URL, for example https://github.com/owner/name`;
        },
      },
    });
  };
}

export class CreateAnalysisDto {
  @IsPublicGitHubRepoUrl()
  repoUrl: string;
}
