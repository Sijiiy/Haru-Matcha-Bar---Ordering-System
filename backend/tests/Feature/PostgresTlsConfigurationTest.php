<?php

namespace Tests\Feature;

use Illuminate\Database\ConfigurationUrlParser;
use Illuminate\Database\Connectors\PostgresConnector;
use Tests\TestCase;

class PostgresTlsConfigurationTest extends TestCase
{
    public function test_laravel_connector_requires_tls_and_preserves_the_session_pooler_target(): void
    {
        // Use synthetic credentials/endpoint. DSN compilation never connects.
        $configuration = config('database.connections.pgsql');
        $configuration['url'] = 'postgresql://fixture_user:fixture_password@pooler.example.invalid:5432/fixture_database';
        $resolved = (new ConfigurationUrlParser)->parseConfiguration($configuration);
        $connector = new class extends PostgresConnector
        {
            public function compileDsn(array $configuration): string
            {
                return $this->getDsn($configuration);
            }
        };

        $this->assertSame('require', $resolved['sslmode']);
        $this->assertSame('pooler.example.invalid', $resolved['host']);
        $this->assertSame(5432, (int) $resolved['port']);
        $this->assertSame('fixture_database', $resolved['database']);
        $this->assertSame('fixture_user', $resolved['username']);
        $this->assertSame('fixture_password', $resolved['password']);
        $dsn = $connector->compileDsn($resolved);
        $this->assertStringContainsString(';sslmode=require', $dsn);
        $this->assertStringContainsString('host=pooler.example.invalid;', $dsn);
        $this->assertStringContainsString("dbname='fixture_database'", $dsn);
        $this->assertStringContainsString(';port=5432', $dsn);
    }
}
