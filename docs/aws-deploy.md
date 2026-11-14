# Índice de propuesta AWS — PENDIENTE

Este documento es únicamente un índice de temas. No constituye una propuesta de arquitectura, capacidad, RPO/RTO verificados ni autorización de despliegue. Estado: `DESIGN_REVIEW_REQUIRED`.

- [ ] Cómputo API: ECS Fargate, App Runner, EKS o Lambda + API Gateway; criterios de elección/alternativas.
- [ ] PostgreSQL: RDS PostgreSQL o Aurora, Multi-AZ y recuperación point-in-time.
- [ ] Objetivos RPO y RTO: pendientes de requisitos, análisis y validación.
- [ ] Hosting web: S3 + CloudFront o Amplify Hosting.
- [ ] Distribución móvil y conexión segura a API.
- [ ] Observabilidad: CloudWatch, X-Ray u OpenTelemetry.
- [ ] Auditoría: CloudTrail, retención y controles por definir.
- [ ] CI/CD: GitHub Actions o CodePipeline, OIDC y ambientes dev/staging/prod.
- [ ] Pools de conexiones y evaluación de RDS Proxy.
- [ ] Evolución ante crecimiento de volumen 100x.
- [ ] Infraestructura como código: CDK, Terraform o SAM.

No se despliega ni publica infraestructura desde BOOT-00.
