using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTeamActivity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TeamId",
                table: "History",
                type: "int",
                nullable: true);

            // Existing task history has only a text description. Associate entries
            // only when every matching task belongs to the same team.
            migrationBuilder.Sql("""
                WITH TeamMatches AS (
                    SELECT history.Id, MIN(task.TeamId) AS TeamId
                    FROM dbo.History AS history
                    INNER JOIN dbo.ProjectTasks AS task ON task.ProjectId = history.ProjectId
                    CROSS JOIN (VALUES
                        (N' created'),
                        (N' status changed to Todo'),
                        (N' status changed to InProgress'),
                        (N' status changed to InReview'),
                        (N' status changed to Completed'),
                        (N' approved'),
                        (N' returned for changes')
                    ) AS suffix(Description)
                    WHERE history.Action COLLATE Latin1_General_100_BIN2 =
                        CONCAT(N'Task ''', task.Title, N'''', suffix.Description) COLLATE Latin1_General_100_BIN2
                    GROUP BY history.Id
                    HAVING COUNT(*) = COUNT(task.TeamId) AND MIN(task.TeamId) = MAX(task.TeamId)
                )
                UPDATE history
                SET TeamId = matches.TeamId
                FROM dbo.History AS history
                INNER JOIN TeamMatches AS matches ON matches.Id = history.Id;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_History_TeamId",
                table: "History",
                column: "TeamId");

            migrationBuilder.AddForeignKey(
                name: "FK_History_Teams_TeamId",
                table: "History",
                column: "TeamId",
                principalTable: "Teams",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_History_Teams_TeamId",
                table: "History");

            migrationBuilder.DropIndex(
                name: "IX_History_TeamId",
                table: "History");

            migrationBuilder.DropColumn(
                name: "TeamId",
                table: "History");
        }
    }
}
