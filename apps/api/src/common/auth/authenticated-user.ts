/** Shape del payload JWT que los guards adjuntan a `request.user`. */
export interface AuthenticatedUser {
  sub: string;
  email?: string;
  permissions: string[];
}
