-- Migración: Añadir tabla para estados OAuth
-- Ejecutar esto en tu base de datos antes de actualizar el código

CREATE TABLE IF NOT EXISTS oauth_states (
    state VARCHAR(255) PRIMARY KEY,
    return_url TEXT NOT NULL DEFAULT '/',
    provider VARCHAR(50) NOT NULL DEFAULT 'google',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Índice para limpiar estados expirados eficientemente
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

-- Comentario: Los estados expiran después de 10 minutos
-- Un job de limpieza puede ejecutar: DELETE FROM oauth_states WHERE expires_at < NOW();
