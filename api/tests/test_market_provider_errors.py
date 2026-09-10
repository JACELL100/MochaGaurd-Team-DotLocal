from app.data.alpha_vantage import QuotaExceeded, _provider_error


def test_alpha_provider_errors_never_echo_api_key():
    error = _provider_error('We detected your API key as secret-value and rate limit is 25 requests per day.')
    assert isinstance(error, QuotaExceeded)
    assert 'secret-value' not in str(error)
