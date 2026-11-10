ssh -C vps "docker exec financeiro-db-1 pg_dump -U financeiro -d db_financeiro -Fc" > dumpfinanceiro.dump
pg_restore --clean --if-exists -v -U financeiro -d db_financeiro dumpfinanceiro.dump