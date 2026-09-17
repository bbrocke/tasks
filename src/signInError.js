export function signInErrorMessage(error) {
  switch (error?.code) {
    case 'over_email_send_rate_limit':
      return "The email service has reached its sending limit. Please try again later, or use a browser where you're already signed in.";
    case 'over_request_rate_limit':
      return 'Too many sign-in requests. Wait at least a minute before requesting another link.';
    case 'email_address_not_authorized':
      return 'The email service is not configured to send to this address. The app owner needs to update the email delivery settings.';
    case 'email_provider_disabled':
      return 'Email sign-in is currently disabled. The app owner needs to enable it.';
    case 'signup_disabled':
      return 'New accounts are not enabled. Use the email associated with your existing account.';
    case 'email_address_invalid':
      return 'Please enter a valid email address.';
    case 'request_timeout':
      return 'The sign-in request timed out. Check your connection and try again.';
    default:
      if (error?.status === 429) return 'Sign-in requests are temporarily limited. Please wait before trying again.';
      if (error instanceof TypeError || error?.name === 'AuthRetryableFetchError') {
        return 'Could not reach the sign-in service. Check your connection and try again.';
      }
      return "The sign-in email could not be sent. Please try again later. If this continues, the app owner needs to check email delivery.";
  }
}
