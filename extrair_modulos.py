#!/usr/bin/env python3
"""
Extrai inventário de módulos do código-fonte do Claude Code.
Roda no Claude Code terminal ou VSCode.

Uso:
  python extrair_modulos.py <caminho_do_src>
  
Exemplo:
  python extrair_modulos.py C:\Workspace\negocios\claude_code_capital\src

Saída: dados/modulos.json
"""

import os
import sys
import json
from pathlib import Path
from collections import defaultdict

def contar_linhas(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return sum(1 for _ in f)
    except:
        return 0

def detectar_tipo(path_rel, conteudo_amostra=""):
    """Classifica o módulo por tipo baseado no path e conteúdo."""
    path_lower = path_rel.lower()
    
    if 'tool' in path_lower:
        return 'tools'
    elif 'permission' in path_lower or 'security' in path_lower or 'sandbox' in path_lower:
        return 'security'
    elif 'coordinator' in path_lower or 'swarm' in path_lower:
        return 'agent'
    elif 'dream' in path_lower or 'memory' in path_lower or 'kairos' in path_lower:
        return 'memory'
    elif 'buddy' in path_lower:
        return 'hidden'
    elif 'undercover' in path_lower:
        return 'security'
    elif 'bridge' in path_lower or 'ide' in path_lower:
        return 'integration'
    elif 'mcp' in path_lower:
        return 'integration'
    elif 'skill' in path_lower or 'plugin' in path_lower:
        return 'extension'
    elif 'ui' in path_lower or 'ink' in path_lower or 'component' in path_lower or 'repl' in path_lower:
        return 'ui'
    elif 'service' in path_lower:
        return 'core'
    else:
        return 'core'

def extrair_imports(filepath):
    """Extrai imports/requires de um arquivo TS/JS."""
    imports = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if line.startswith('import ') or line.startswith('from '):
                    # Extrair o path do import
                    if "from '" in line:
                        mod = line.split("from '")[1].rstrip("';")
                        imports.append(mod)
                    elif 'from "' in line:
                        mod = line.split('from "')[1].rstrip('";')
                        imports.append(mod)
                elif 'require(' in line:
                    if "require('" in line:
                        mod = line.split("require('")[1].split("')")[0]
                        imports.append(mod)
                    elif 'require("' in line:
                        mod = line.split('require("')[1].split('")')[0]
                        imports.append(mod)
    except:
        pass
    return imports

def extrair_exports(filepath):
    """Extrai exports de um arquivo TS/JS."""
    exports = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if line.startswith('export '):
                    # Capturar nome da função/classe/const exportada
                    parts = line.split()
                    if len(parts) >= 3:
                        if parts[1] in ('function', 'class', 'const', 'let', 'var', 'type', 'interface', 'enum'):
                            name = parts[2].split('(')[0].split(':')[0].split('<')[0].split('=')[0].strip()
                            exports.append(name)
                        elif parts[1] == 'default':
                            exports.append('default')
    except:
        pass
    return exports

def escanear_diretorio(src_path):
    """Escaneia o diretório src e coleta info de cada arquivo."""
    
    src = Path(src_path)
    if not src.exists():
        print(f"ERRO: Diretório não encontrado: {src_path}")
        sys.exit(1)
    
    extensoes_validas = {'.ts', '.tsx', '.js', '.jsx'}
    modulos = []
    total_linhas = 0
    
    for filepath in sorted(src.rglob('*')):
        if filepath.suffix not in extensoes_validas:
            continue
        if 'node_modules' in str(filepath):
            continue
            
        path_rel = str(filepath.relative_to(src))
        linhas = contar_linhas(filepath)
        total_linhas += linhas
        tipo = detectar_tipo(path_rel)
        imports = extrair_imports(filepath)
        exports = extrair_exports(filepath)
        
        modulos.append({
            'path': path_rel.replace('\\', '/'),
            'lines': linhas,
            'type': tipo,
            'imports': imports[:20],  # Limitar para não ficar gigante
            'exports': exports[:20],
            'size_kb': round(filepath.stat().st_size / 1024, 1),
        })
    
    return modulos, total_linhas

def gerar_resumo(modulos, total_linhas):
    """Gera estatísticas resumidas."""
    por_tipo = defaultdict(lambda: {'count': 0, 'lines': 0})
    
    for m in modulos:
        por_tipo[m['type']]['count'] += 1
        por_tipo[m['type']]['lines'] += m['lines']
    
    maiores = sorted(modulos, key=lambda m: m['lines'], reverse=True)[:20]
    
    return {
        'total_arquivos': len(modulos),
        'total_linhas': total_linhas,
        'por_tipo': dict(por_tipo),
        'maiores_arquivos': [
            {'path': m['path'], 'lines': m['lines'], 'type': m['type']}
            for m in maiores
        ]
    }

def main():
    if len(sys.argv) < 2:
        # Tentar path padrão
        src_path = r"C:\Workspace\negocios\claude_code_capital\src"
        if not Path(src_path).exists():
            print("Uso: python extrair_modulos.py <caminho_do_src>")
            sys.exit(1)
    else:
        src_path = sys.argv[1]
    
    print(f"Escaneando: {src_path}")
    modulos, total_linhas = escanear_diretorio(src_path)
    resumo = gerar_resumo(modulos, total_linhas)
    
    # Criar diretório de saída
    output_dir = Path("dados")
    output_dir.mkdir(exist_ok=True)
    
    # Salvar módulos
    with open(output_dir / "modulos.json", 'w', encoding='utf-8') as f:
        json.dump({
            'meta': {
                'versao': '2.1.88',
                'fonte': 'Claude Code npm sourcemap leak',
                'data_extracao': '2026-04-04',
                'total_arquivos': len(modulos),
                'total_linhas': total_linhas,
            },
            'resumo': resumo,
            'modulos': modulos,
        }, f, ensure_ascii=False, indent=2)
    
    # Salvar resumo separado
    with open(output_dir / "resumo.json", 'w', encoding='utf-8') as f:
        json.dump(resumo, f, ensure_ascii=False, indent=2)
    
    print(f"\nResultado:")
    print(f"  Arquivos: {len(modulos)}")
    print(f"  Linhas:   {total_linhas:,}")
    print(f"\nPor tipo:")
    for tipo, info in sorted(resumo['por_tipo'].items()):
        print(f"  {tipo:15s} {info['count']:4d} arquivos  {info['lines']:8,} linhas")
    print(f"\nTop 10 maiores:")
    for m in resumo['maiores_arquivos'][:10]:
        print(f"  {m['lines']:8,} linhas  {m['path']}")
    print(f"\nSalvo em: dados/modulos.json e dados/resumo.json")

if __name__ == '__main__':
    main()
