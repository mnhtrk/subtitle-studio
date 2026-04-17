use reqwest::StatusCode;
use tokio::time::{sleep, Duration};

#[derive(Debug)]
pub struct NetworkError {
    pub message: String,
    pub retry_after: Option<u64>,
    pub should_retry: bool,
}

impl NetworkError {
    pub fn new(message: String, retry_after: Option<u64>, should_retry: bool) -> Self {
        Self {
            message,
            retry_after,
            should_retry,
        }
    }
}

/// Выполняет HTTP запрос с автоматической повторной попыткой
pub async fn execute_with_retry<T, F, Fut>(
    mut request_fn: F,
    max_retries: u32,
) -> Result<T, NetworkError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, reqwest::Error>>,
{
    let mut attempt = 0;
    
    loop {
        attempt += 1;
        
        match request_fn().await {
            Ok(result) => return Ok(result),
            Err(err) => {
                if attempt > max_retries {
                    return Err(NetworkError::new(
                        format!("Превышено количество попыток ({})", max_retries),
                        None,
                        false,
                    ));
                }
                
                let should_retry = should_retry_request(&err);
                if !should_retry {
                    return Err(NetworkError::new(
                        format!("Ошибка запроса: {}", err),
                        None,
                        false,
                    ));
                }
                
                let retry_delay = calculate_retry_delay(attempt, &err);
                println!("🔄 Повторная попытка {} через {} секунд...", attempt, retry_delay);
                sleep(Duration::from_secs(retry_delay)).await;
            }
        }
    }
}

/// Определяет, стоит ли повторять запрос
fn should_retry_request(err: &reqwest::Error) -> bool {
    if err.is_timeout() {
        return true;
    }
    
    if let Some(status) = err.status() {
        match status {
            StatusCode::TOO_MANY_REQUESTS => true,      // 429
            StatusCode::INTERNAL_SERVER_ERROR => true,   // 500
            StatusCode::BAD_GATEWAY => true,            // 502
            StatusCode::SERVICE_UNAVAILABLE => true,     // 503
            StatusCode::GATEWAY_TIMEOUT => true,         // 504
            _ => false,
        }
    } else {
        err.is_connect() || err.is_body() || err.is_decode()
    }
}

/// Рассчитывает задержку перед повторной попыткой
fn calculate_retry_delay(attempt: u32, err: &reqwest::Error) -> u64 {
    // Базовая задержка (экспоненциальный бэкoff)
    let base_delay = 2u64.pow(attempt - 1);
    
    // Максимальная задержка - 60 секунд
    let delay = base_delay.min(60);
    
    // Если есть заголовок Retry-After, используем его
    if let Some(status) = err.status() {
        if status == StatusCode::TOO_MANY_REQUESTS {
            // Для OpenAI рейт-лимиты обычно 1 секунда
            return delay.max(1);
        }
    }
    
    delay
}

/// Извлекает время повторной попытки из заголовков ответа
pub fn extract_retry_after(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get("retry-after")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse().ok())
}