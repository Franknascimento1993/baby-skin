# Avaliações (Staticman) – Sono da Beleza

Este diretório recebe **arquivos JSON** criados via **Staticman v3** a partir do formulário no site.
Cada envio gera um **Pull Request** com um arquivo em `reviews/comments/`.

## Como funciona
1. O cliente preenche o formulário no site.
2. O Staticman cria um PR com o arquivo:  
   `reviews/comments/<timestamp>-<id>.json`
3. **Você revisa** o PR no GitHub:
   - Se aprovar, faça **Merge** (entra para o histórico do repositório).
   - Se quiser, edite/corrija o texto antes do merge.
4. O site já mostra um **cartão de “Enviado para aprovação”** no lado do cliente e
   mantém uma cópia local (apenas naquele navegador). A aprovação **global** é via GitHub (merge do PR).

> Importante: o repositório precisa estar **público** para a instância pública do Staticman abrir PRs.

## Dicas
- Domínios autorizados para envio estão definidos em `staticman.yml` (`allowedOrigins`).
  Se publicar o site em outro domínio, **adicione lá**.
- O PIN do modo admin local (no site) está no código (`ADMIN_PIN`).
  Acesse `?admin=1` ou `#admin` para ativar e moderar **apenas o storage local** do navegador.
- Se a rede cair ou o endpoint recusar CORS, o site **enfileira** o envio e tenta novamente
  automaticamente (fila offline).

## Estrutura dos arquivos JSON
```json
{
  "id": "kx3ab1",
  "rating": 5,
  "name": "Cliente",
  "comment": "Amei o resultado!",
  "photos": ["data:image/jpeg;base64,..."],
  "date": "2025-08-23T23:59:59.000Z",
  "approved": false,
  "_timestamp": "2025-08-23T23:59:59.000Z"
}
