#!/bin/bash
# setup_projeto.sh
# Rodar dentro de C:\Workspace\negocios\claude_code_capital\
# (No Windows, usar Git Bash ou WSL)

echo "=== Criando estrutura do projeto Anatomia de um Agente de IA ==="

# Repo principal
mkdir -p anatomia-agente-ia/{nucleo,analise,pratica,cartografias,dados,diario,docs,edicoes,site}
mkdir -p anatomia-agente-ia/cartografias/{c0-visao-orbital,c1-anatomia,c2-fluxo,c3-permissoes,c4-ontologia,c5-memoria,c6-multi-agent,c7-governanca}

# Repo de produtos
mkdir -p claude-code-otimizacao/{guias,tools,templates/{claude-md,skills},squads}

# Repo de cartografias
mkdir -p cartografias-ia/{src,data,docs}

# Copiar arquivos gerados
# (assumindo que os outputs do Claude estão acessíveis)
# cp README.md anatomia-agente-ia/
# cp CLAUDE.md anatomia-agente-ia/
# cp extrair_modulos.py anatomia-agente-ia/
# cp diario-2026-04-04.md anatomia-agente-ia/diario/2026-04-04.md
# cp cartografia-claude-code-c0.jsx anatomia-agente-ia/cartografias/c0-visao-orbital/

echo ""
echo "=== Estrutura criada ==="
echo ""
echo "Próximos passos:"
echo "  1. cd anatomia-agente-ia"
echo "  2. git init"
echo "  3. Copiar README.md, CLAUDE.md, e demais arquivos para os lugares certos"
echo "  4. git add -A && git commit -m 'Dia 0: estrutura inicial do projeto'"
echo "  5. Criar repo no GitHub: anatomia-agente-ia"
echo "  6. git remote add origin git@github.com:SEU_USER/anatomia-agente-ia.git"
echo "  7. git push -u origin main"
echo "  8. Rodar: python extrair_modulos.py ../src"
echo "  9. Publicar post #1 no LinkedIn"
echo ""
echo "Estrutura de diretórios:"
find anatomia-agente-ia -type d | head -30
echo "..."
