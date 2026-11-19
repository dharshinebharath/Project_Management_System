FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend.Api/backend.Api.csproj backend.Api/
RUN dotnet restore backend.Api/backend.Api.csproj
COPY backend.Api/ backend.Api/
RUN dotnet publish backend.Api/backend.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "backend.Api.dll"]
