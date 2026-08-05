import { useRef, useEffect, useState } from "preact/hooks";

// Image paths
const IMG_YELLOW_SQUARE = "/games/IW/the_beast_from_beyond/venom/venom_maze/pictures/yellow_square.webp";
const IMG_BLUE_DIAMOND = "/games/IW/the_beast_from_beyond/venom/venom_maze/pictures/blue_diamond.webp";

// Type definitions
interface MazeSolution {
    start: [number, number];
    end: [number, number];
    path: [number, number][];
}

type DraggableType = "start" | "end";

interface DraggableState {
    type: DraggableType;
    position: [number, number] | null;
}

// Maze solution data
const mazeSolutionCoordinates: MazeSolution[] = [
    {
        start: [0, 5],
        end: [3, 4],
        path: [
            [0, 5], [0, 4], [1, 4], [1, 5], [5, 5], [5, 1], [4, 1], [4, 3], [3, 3], [3, 4],
        ],
    },
    {
        start: [1, 2],
        end: [4, 4],
        path: [
            [1, 2], [2, 2], [2, 1], [1, 1], [1, 0], [0, 0], [0, 4], [1, 4], [1, 5], [4, 5], [4, 4],
        ],
    },
    {
        start: [3, 1],
        end: [0, 4],
        path: [
            [3, 1], [1, 1], [1, 2], [2, 2], [2, 3], [1, 3], [1, 4], [2, 4], [2, 5], [0, 5], [0, 4],
        ],
    },
    {
        start: [4, 4],
        end: [2, 2],
        path: [
            [4, 4], [4, 3], [5, 3], [5, 0], [2, 0], [2, 2],
        ],
    },
    {
        start: [0, 4],
        end: [4, 2],
        path: [
            [0, 4], [0, 5], [1, 5], [1, 3], [0, 3], [0, 0], [5, 0], [5, 2], [4, 2],
        ],
    },
    {
        start: [1, 2],
        end: [5, 3],
        path: [
            [1, 2], [0, 2], [0, 5], [1, 5], [1, 3], [2, 3], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 4], [5, 3],
        ],
    },
    {
        start: [1, 1],
        end: [4, 3],
        path: [
            [1, 1], [2, 1], [2, 2], [3, 2], [3, 1], [4, 1], [4, 2], [5, 2], [5, 5], [4, 5], [4, 3],
        ],
    },
    {
        start: [3, 2],
        end: [4, 1],
        path: [
            [3, 2], [3, 3], [2, 3], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0], [4, 0], [4, 1],
        ],
    },
    {
        start: [0, 5],
        end: [4, 0],
        path: [
            [0, 5], [0, 4], [1, 4], [1, 2], [0, 2], [0, 1], [2, 1], [2, 3], [4, 3], [4, 0],
        ],
    },
    {
        start: [2, 0],
        end: [2, 3],
        path: [
            [2, 0], [0, 0], [0, 5], [2, 5], [2, 4], [1, 4], [1, 2], [3, 2], [3, 3], [2, 3],
        ],
    },
    {
        start: [4, 5],
        end: [3, 3],
        path: [
            [4, 5], [1, 5], [1, 4], [2, 4], [2, 2], [3, 2], [3, 3],
        ],
    },
    {
        start: [3, 4],
        end: [2, 1],
        path: [
            [3, 4], [3, 5], [5, 5], [5, 1], [4, 1], [4, 2], [2, 2], [2, 1],
        ],
    },
    {
        start: [0, 1],
        end: [5, 3],
        path: [
            [0, 1], [0, 0], [1, 0], [1, 1], [3, 1], [3, 2], [2, 2], [2, 3], [5, 3],
        ],
    },
    {
        start: [1, 4],
        end: [5, 0],
        path: [
            [1, 4], [1, 3], [2, 3], [2, 5], [3, 5], [3, 3], [4, 3], [4, 4], [5, 4], [5, 0],
        ],
    },
    {
        start: [3, 1],
        end: [1, 2],
        path: [
            [3, 1], [4, 1], [4, 2], [5, 2], [5, 3], [4, 3], [4, 4], [3, 4], [3, 5], [2, 5], [2, 3], [3, 3], [3, 2], [2, 2], [2, 1], [1, 1], [1, 2],
        ],
    },
];

function findSolPath(startCoords: [number, number], endCoords: [number, number]): [number, number][] | null {
    const solution = mazeSolutionCoordinates.find(
        ({ start, end }) =>
            JSON.stringify(start) === JSON.stringify(startCoords) && JSON.stringify(end) === JSON.stringify(endCoords),
    );
    return solution ? solution.path : null;
}

export default function IWBeastVenomXMazeSolver({ title }: { title?: string }) {
    const [draggables, setDraggables] = useState<DraggableState[]>([
        { type: "start", position: null },
        { type: "end", position: null },
    ]);
    const [errorMessage, setErrorMessage] = useState<string>("");
    const [solutionPath, setSolutionPath] = useState<[number, number][] | null>(null);
    const [selectedPiece, setSelectedPiece] = useState<DraggableType | null>(null);
    const [validPositions, setValidPositions] = useState<[number, number][]>([]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const boardRef = useRef<HTMLDivElement>(null);

    const drawPath = (pathCoords: [number, number][], color = "blue", width = 10) => {
        const canvas = canvasRef.current;
        const board = boardRef.current;
        if (!canvas || !board) return;

        const boardRect = board.getBoundingClientRect();
        const cellSize = boardRect.width / 6;

        canvas.width = boardRect.width;
        canvas.height = boardRect.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();

        pathCoords.forEach((coord, index) => {
            const x = coord[1] * cellSize + cellSize / 2;
            const y = coord[0] * cellSize + cellSize / 2;
            const padding = 0.4;

            if (index === 0) {
                const nextCoord = pathCoords[1];
                const deltaX = nextCoord[1] - coord[1];
                const deltaY = nextCoord[0] - coord[0];

                if (deltaX > 0) ctx.moveTo(x + cellSize * padding, y);
                else if (deltaX < 0) ctx.moveTo(x - cellSize * padding, y);
                else if (deltaY > 0) ctx.moveTo(x, y + cellSize * padding);
                else if (deltaY < 0) ctx.moveTo(x, y - cellSize * padding);
                else ctx.moveTo(x, y);
            } else if (index === pathCoords.length - 1) {
                const prevCoord = pathCoords[index - 1];
                const deltaX = coord[1] - prevCoord[1];
                const deltaY = coord[0] - prevCoord[0];

                if (deltaX > 0) ctx.lineTo(x - cellSize * padding, y);
                else if (deltaX < 0) ctx.lineTo(x + cellSize * padding, y);
                else if (deltaY > 0) ctx.lineTo(x, y - cellSize * padding);
                else if (deltaY < 0) ctx.lineTo(x, y + cellSize * padding);
                else ctx.lineTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
    };

    useEffect(() => {
        const handleResize = () => {
            if (solutionPath) drawPath(solutionPath);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [solutionPath]);

    useEffect(() => {
        if (solutionPath) drawPath(solutionPath);
    }, [solutionPath]);

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    const handleTrayPieceClick = (type: DraggableType) => {
        const piece = draggables.find((d) => d.type === type);

        if (piece?.position) {
            setDraggables((prev) => prev.map((d) => (d.type === type ? { ...d, position: null } : d)));
            setSelectedPiece(type);
            setSolutionPath(null);
            setValidPositions([]);
            clearCanvas();
            setErrorMessage("");
        } else {
            setSelectedPiece((prev) => (prev === type ? null : type));
        }
    };

    const runSolve = (currentDraggables: DraggableState[]) => {
        const placedCount = currentDraggables.filter((d) => d.position).length;

        if (placedCount === 1) {
            const placedPiece = currentDraggables.find((d) => d.position)!;
            const unplacedType: DraggableType = placedPiece.type === "start" ? "end" : "start";

            const matchingSolutions =
                placedPiece.type === "start"
                    ? mazeSolutionCoordinates.filter(
                        ({ start }) => JSON.stringify(start) === JSON.stringify(placedPiece.position),
                    )
                    : mazeSolutionCoordinates.filter(
                        ({ end }) => JSON.stringify(end) === JSON.stringify(placedPiece.position),
                    );

            const validCells = matchingSolutions.map((s) => (placedPiece.type === "start" ? s.end : s.start));

            if (matchingSolutions.length === 1) {
                const autoPosition = validCells[0];
                const newDraggables = currentDraggables.map((d) =>
                    d.type === unplacedType ? { ...d, position: autoPosition } : d,
                );
                setDraggables(newDraggables);
                setValidPositions([]);
                const startPos = newDraggables.find((d) => d.type === "start")!.position!;
                const endPos = newDraggables.find((d) => d.type === "end")!.position!;
                const solPath = findSolPath(startPos, endPos);
                if (solPath) {
                    setErrorMessage("");
                    setSolutionPath(solPath);
                }
            } else if (matchingSolutions.length > 1) {
                setValidPositions(validCells);
                setSolutionPath(null);
                clearCanvas();
            }
            return;
        }

        setValidPositions([]);

        if (placedCount < 2) return;

        const startDraggable = currentDraggables.find((d) => d.type === "start");
        const endDraggable = currentDraggables.find((d) => d.type === "end");

        if (!startDraggable?.position || !endDraggable?.position) return;

        const solPath = findSolPath(startDraggable.position, endDraggable.position);

        if (!solPath) {
            setErrorMessage("No solution found, please try again.");
            setSolutionPath(null);
            return;
        }

        setErrorMessage("");
        setSolutionPath(solPath);
    };

    const handleCellClick = (row: number, col: number) => {
        const pieceInCell = draggables.find((d) => d.position && d.position[0] === row && d.position[1] === col);

        if (pieceInCell) {
            setDraggables((prev) => prev.map((d) => (d.type === pieceInCell.type ? { ...d, position: null } : d)));
            setSelectedPiece(pieceInCell.type);
            setSolutionPath(null);
            setValidPositions([]);
            clearCanvas();
            setErrorMessage("");
        } else if (selectedPiece) {
            const newDraggables = draggables.map((d) =>
                d.type === selectedPiece ? { ...d, position: [row, col] as [number, number] } : d,
            );
            setDraggables(newDraggables);
            setSelectedPiece(null);
            setErrorMessage("");
            runSolve(newDraggables);
        }
    };

    const handleReset = () => {
        setDraggables([
            { type: "start", position: null },
            { type: "end", position: null },
        ]);
        setSelectedPiece(null);
        setErrorMessage("");
        setSolutionPath(null);
        setValidPositions([]);
        clearCanvas();
    };

    const renderBoard = () => {
        const squares = [];
        const unplacedDraggable = validPositions.length > 0 ? draggables.find((d) => !d.position) : null;

        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                const draggable = draggables.find((d) => d.position && d.position[0] === row && d.position[1] === col);
                const isValidPosition =
                    !draggable && validPositions.some((vp) => vp[0] === row && vp[1] === col);

                const cellClass = isValidPosition ? "venom-cell is-target" : "venom-cell";

                squares.push(
                    <div
                        key={`square-${row}-${col}`}
                        className={cellClass}
                        onClick={() => handleCellClick(row, col)}
                    >
                        {draggable && (
                            <img loading="lazy"
                                className="venom-piece"
                                src={draggable.type === "start" ? IMG_YELLOW_SQUARE : IMG_BLUE_DIAMOND}
                                alt={draggable.type === "start" ? "Yellow Square" : "Blue Diamond"}
                            />
                        )}
                        {isValidPosition && unplacedDraggable && (
                            <img loading="lazy"
                                className="venom-piece is-preview"
                                src={unplacedDraggable.type === "start" ? IMG_YELLOW_SQUARE : IMG_BLUE_DIAMOND}
                                alt=""
                            />
                        )}
                    </div>,
                );
            }
        }

        return squares;
    };

    const renderTray = () => {
        return (
            <div className="solver-symbol-select">
                {draggables.map((d) => {
                    const isSelected = selectedPiece === d.type;
                    const classes: string[] = [];
                    if (isSelected) classes.push("is-selected");
                    if (d.position) classes.push("is-placed");
                    return (
                        <button
                            key={d.type}
                            className={classes.join(" ")}
                            onClick={() => handleTrayPieceClick(d.type)}
                            aria-pressed={isSelected}
                            aria-label={d.type === "start" ? "Yellow Square" : "Blue Diamond"}
                        >
                            <img loading="lazy"
                                src={d.type === "start" ? IMG_YELLOW_SQUARE : IMG_BLUE_DIAMOND}
                                alt=""
                            />
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="solver-container solver-container--venom-maze">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Click the Yellow Square or Blue Diamond to select it, then click a grid cell to place it. Once placed,
                valid positions for the other piece will be shown. If there is only one solution, it'll be drawn
                automatically. Click a placed piece to pick it back up.
            </p>

            {renderTray()}

            <div className="solver-grid-wrapper is-fit">
                <div ref={boardRef} className="solver-grid is-framed">
                    {renderBoard()}
                    <canvas ref={canvasRef} className="venom-canvas" />
                </div>
            </div>

            {errorMessage && <p className="solver-error">{errorMessage}</p>}

            <div className="solver-controls">
                <button className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>
        </div>
    );
}