import { useState } from "preact/hooks";

const solution_cords_queens: number[][][] = [
    [[0, 0], [1, 4], [2, 7], [3, 5], [4, 2], [5, 6], [6, 1], [7, 3]],
    [[0, 0], [1, 5], [2, 7], [3, 2], [4, 6], [5, 3], [6, 1], [7, 4]],
    [[0, 1], [1, 3], [2, 5], [3, 7], [4, 2], [5, 0], [6, 6], [7, 4]],
    [[0, 1], [1, 4], [2, 6], [3, 0], [4, 2], [5, 7], [6, 5], [7, 3]],
    [[0, 1], [1, 4], [2, 6], [3, 3], [4, 0], [5, 7], [6, 5], [7, 2]],
    [[0, 1], [1, 5], [2, 0], [3, 6], [4, 3], [5, 7], [6, 2], [7, 4]],
    [[0, 1], [1, 5], [2, 7], [3, 2], [4, 0], [5, 3], [6, 6], [7, 4]],
    [[0, 1], [1, 6], [2, 2], [3, 5], [4, 7], [5, 4], [6, 0], [7, 3]],
    [[0, 1], [1, 6], [2, 4], [3, 7], [4, 0], [5, 3], [6, 5], [7, 2]],
    [[0, 2], [1, 4], [2, 7], [3, 3], [4, 0], [5, 6], [6, 1], [7, 5]],
    [[0, 2], [1, 5], [2, 1], [3, 4], [4, 7], [5, 0], [6, 6], [7, 3]],
    [[0, 2], [1, 4], [2, 1], [3, 7], [4, 0], [5, 6], [6, 3], [7, 5]],
];

function create2DArray(coords: number[][], size = 8): boolean[][] {
    const array = Array.from({ length: size }, () => Array(size).fill(false));
    coords.forEach(([x, y]) => {
        array[x][y] = true;
    });
    return array;
}

const solutions_queens: boolean[][][] = solution_cords_queens.map((coords) => create2DArray(coords));

function rotate2DArrayToRight(array: boolean[][]): boolean[][] {
    const size = array.length;
    const rotated = Array.from({ length: size }, () => Array(size).fill(false));
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            rotated[j][size - 1 - i] = array[i][j];
        }
    }
    return rotated;
}

function flip2DArray(array: boolean[][], direction: "horizontal" | "vertical"): boolean[][] {
    const size = array.length;
    const flipped = Array.from({ length: size }, () => Array(size).fill(false));

    if (direction === "horizontal") {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                flipped[i][size - 1 - j] = array[i][j];
            }
        }
    } else {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                flipped[size - 1 - i][j] = array[i][j];
            }
        }
    }

    return flipped;
}

function find_valid_sol(starting_queen_cords: number[]) {
    const starting_x = starting_queen_cords[0];
    const starting_y = starting_queen_cords[1];

    const flipped_options: ("horizontal" | "vertical")[] = ["vertical", "horizontal"];

    for (let i = 0; i < solutions_queens.length; i++) {
        let solution: boolean[][] = solutions_queens[i];

        for (let j = 0; j < 4; j++) {
            if (solution[starting_y][starting_x]) return solution;

            for (const flip of flipped_options) {
                const solution_flipped = flip2DArray(solution, flip);
                if (solution_flipped[starting_y][starting_x]) return solution_flipped;
            }

            solution = rotate2DArrayToRight(solution);
        }
    }

    return null;
}

type Phase = "setup" | "solved";

export default function IWBeastEightQueensSolver({ title }: { title?: string }) {
    const [queenLocation, setQueenLocation] = useState<[number, number]>([0, 0]);
    const [solution, setSolution] = useState<boolean[][] | null>(null);
    const [phase, setPhase] = useState<Phase>("setup");

    const message =
        phase === "setup"
            ? "Click the square where the starting Queen sits in your game, then press Solve."
            : solution
                ? "Solution found — place the remaining Queens at the marked squares."
                : "No solution found. Reset and try a different starting square.";

    const handleSquareClick = (row: number, col: number) => {
        if (phase !== "setup") return;
        setQueenLocation([row, col]);
    };

    const handleSolve = () => {
        const [y, x] = queenLocation;
        const sol = find_valid_sol([x, y]);
        setSolution(sol);
        setPhase("solved");
    };

    const handleReset = () => {
        setSolution(null);
        setQueenLocation([0, 0]);
        setPhase("setup");
    };

    const renderBoard = () => {
        const squares = [];
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const isLight = (row + col) % 2 === 0;
                const hasQueen = solution
                    ? solution[row][col]
                    : row === queenLocation[0] && col === queenLocation[1];

                const classes = [
                    "queens-cell",
                    isLight ? "queens-cell--light" : "queens-cell--dark",
                ];
                if (hasQueen) classes.push("is-queen");

                squares.push(
                    <div
                        key={`queen-square-${row}-${col}`}
                        className={classes.join(" ")}
                        onClick={() => handleSquareClick(row, col)}
                    />,
                );
            }
        }
        return squares;
    };

    return (
        <div
            className="solver-container solver-container--queens"
            data-phase={phase}
        >
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">{message}</p>

            <div className="solver-grid-wrapper is-fit">
                <div className="queens-board">{renderBoard()}</div>
            </div>

            <div className="solver-controls">
                <button
                    className="btn btn--solver"
                    onClick={handleSolve}
                    disabled={phase !== "setup"}
                >
                    Solve
                </button>
                <button className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>
        </div>
    );
}