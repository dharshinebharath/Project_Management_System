using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTeamResources : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TeamId",
                table: "Files",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Files_TeamId",
                table: "Files",
                column: "TeamId");

            migrationBuilder.AddForeignKey(
                name: "FK_Files_Teams_TeamId",
                table: "Files",
                column: "TeamId",
                principalTable: "Teams",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Files_Teams_TeamId",
                table: "Files");

            migrationBuilder.DropIndex(
                name: "IX_Files_TeamId",
                table: "Files");

            migrationBuilder.DropColumn(
                name: "TeamId",
                table: "Files");
        }
    }
}
